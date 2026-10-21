param([Parameter(Mandatory=$true)][string]$Cwd)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class RepositoryBranch {
    const uint Read = 0x80000000, Attributes = 0x80;
    const uint ShareRead = 1, OpenExisting = 3;
    const uint OpenReparse = 0x00200000, BackupSemantics = 0x02000000;
    const uint Directory = 0x10, Reparse = 0x400;
    const int Limit = 4096;
    [StructLayout(LayoutKind.Sequential)]
    struct Information {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security,
                                            uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Information information);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
    static extern uint GetDriveTypeW(string root);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint length, uint flags);

    static string PhysicalPath(SafeFileHandle handle) {
        // VOLUME_NAME_NT: compare kernel handle paths, not mutable DOS drive aliases.
        var path = new StringBuilder(Limit + 1);
        uint length = GetFinalPathNameByHandleW(handle, path, (uint)path.Capacity, 2);
        if (length == 0 || length >= path.Capacity) throw new IOException();
        string physical = path.ToString().TrimEnd('\\');
        if (!physical.StartsWith("\\Device\\", StringComparison.Ordinal) ||
            physical.StartsWith("\\Device\\Mup\\", StringComparison.OrdinalIgnoreCase) ||
            physical.StartsWith("\\Device\\LanmanRedirector\\", StringComparison.OrdinalIgnoreCase)) throw new IOException();
        return physical;
    }
    static string PhysicalParent(string path) {
        int separator = path.LastIndexOf('\\');
        if (separator <= 0) throw new IOException();
        return path.Substring(0, separator);
    }

    sealed class Pinned : IDisposable {
        readonly List<SafeFileHandle> handles = new List<SafeFileHandle>();
        readonly List<FileStream> streams = new List<FileStream>();
        readonly Dictionary<string, string> directories = new Dictionary<string, string>(StringComparer.Ordinal);
        public SafeFileHandle Open(string path, bool directory, bool missing, out Information info) {
            // No FILE_SHARE_DELETE: ancestors and leaves cannot be renamed/replaced
            // until the complete pointer/backlink/HEAD transaction has finished.
            var handle = CreateFileW(path, directory ? Attributes : Read, ShareRead,
                IntPtr.Zero, OpenExisting, OpenReparse | BackupSemantics, IntPtr.Zero);
            if (handle.IsInvalid) {
                int error = Marshal.GetLastWin32Error(); handle.Dispose(); info = new Information();
                if (missing && error == 2) return null;
                throw new Win32Exception(error);
            }
            try {
                if (!GetFileInformationByHandle(handle, out info) || (info.Attributes & Reparse) != 0 ||
                    (directory && (info.Attributes & Directory) == 0)) throw new IOException();
                string physical = PhysicalPath(handle);
                if (!Equal(path, Path.GetPathRoot(path))) {
                    string parent;
                    if (!directories.TryGetValue(Path.GetDirectoryName(path), out parent) ||
                        !Equal(PhysicalParent(physical), parent)) throw new IOException();
                }
                // Cache the handle's physical directory identity only after binding
                // it to its pinned parent. Every leaf is bound before any read.
                if (directory) directories.Add(path, physical);
                handles.Add(handle); return handle;
            } catch {
                handle.Dispose(); throw;
            }
        }
        public void DirectoryPath(string path) {
            string root = Path.GetPathRoot(path);
            uint drive = GetDriveTypeW(root);
            if (drive != 3 && drive != 6) throw new IOException();
            Information info;
            if (!directories.ContainsKey(root)) Open(root, true, false, out info);
            string current = root;
            foreach (string component in path.Substring(root.Length).Split(new char[]{'\\'}, StringSplitOptions.RemoveEmptyEntries)) {
                current = Path.Combine(current, component);
                if (!directories.ContainsKey(current)) Open(current, true, false, out info);
            }
        }
        public string Text(string path) {
            DirectoryPath(Path.GetDirectoryName(path));
            Information info; var handle = Open(path, false, false, out info);
            if ((info.Attributes & Directory) != 0 || info.Links != 1 || info.SizeHigh != 0 || info.SizeLow > Limit)
                throw new IOException();
            // The stream owns this already-opened no-follow handle. The Pinned list
            // retains all ancestor handles until this whole read finishes.
            var stream = new FileStream(handle, FileAccess.Read, Limit, false);
            streams.Add(stream);
            {
                byte[] bytes = new byte[Limit + 1]; int length = 0;
                while (length < bytes.Length) {
                    int count = stream.Read(bytes, length, bytes.Length - length);
                    if (count == 0) break;
                    length += count;
                }
                if (length > Limit) throw new IOException();
                string text = new UTF8Encoding(false, true).GetString(bytes, 0, length);
                if (text.IndexOf('\0') >= 0) throw new IOException();
                return text.TrimEnd('\r', '\n');
            }
        }
        public void Dispose() { foreach (var stream in streams) stream.Dispose(); foreach (var handle in handles) handle.Dispose(); }
    }
    static string Canonical(string parent, string value) {
        if (String.IsNullOrEmpty(value) || value.Length > Limit) throw new IOException();
        foreach (char ch in value) if (ch < 32 || ch == 127) throw new IOException();
        value = value.Replace('/', '\\');
        foreach (string component in value.Split('\\')) {
            if (component != "." && component != ".." && (component.EndsWith(".") || component.EndsWith(" "))) throw new IOException();
        }
        if (value.IndexOf(':', Math.Min(2, value.Length)) >= 0) throw new IOException();
        if (value.StartsWith("\\\\") || value.StartsWith("\\")) throw new IOException();
        if (value.IndexOf(':') >= 0 && !(value.Length >= 3 && Char.IsLetter(value[0]) && value[1] == ':' && value[2] == '\\'))
            throw new IOException();
        string full = Path.GetFullPath(Path.IsPathRooted(value) ? value : Path.Combine(parent, value));
        if (full.Length > Limit || full.Length < 3 || full[1] != ':' || full[2] != '\\') throw new IOException();
        return full.Length > 3 ? full.TrimEnd('\\') : full;
    }
    static bool Equal(string left, string right) { return String.Equals(left, right, StringComparison.Ordinal); }
    public static string ReadBranch(string input) {
        string folder = Canonical("C:\\", input);
        using (var pin = new Pinned()) {
            for (int depth = 0; depth < 8; depth++) {
                pin.DirectoryPath(folder);
                string marker = Path.Combine(folder, ".git");
                Information info; var handle = pin.Open(marker, false, true, out info);
                if (handle == null) {
                    var parent = DirectoryInfoParent(folder);
                    if (parent == null) return null;
                    folder = parent; continue;
                }
                string gitdir;
                if ((info.Attributes & Directory) != 0) {
                    gitdir = marker; pin.DirectoryPath(gitdir);
                } else {
                    if (info.Links != 1) throw new IOException();
                    string pointer = pin.Text(marker);
                    if (!pointer.StartsWith("gitdir: ", StringComparison.Ordinal)) throw new IOException();
                    gitdir = Canonical(folder, pointer.Substring(8));
                    if (!gitdir.StartsWith(folder.TrimEnd('\\') + "\\", StringComparison.Ordinal)) {
                        string registration = "\\.git\\worktrees\\";
                        int at = gitdir.LastIndexOf(registration, StringComparison.Ordinal);
                        if (at < 0 || at + registration.Length >= gitdir.Length ||
                            gitdir.IndexOf('\\', at + registration.Length) >= 0) throw new IOException();
                        pin.DirectoryPath(gitdir);
                        string backlink = Canonical(gitdir, pin.Text(Path.Combine(gitdir, "gitdir")));
                        if (!Equal(backlink, marker)) throw new IOException();
                        string common = Canonical(gitdir, pin.Text(Path.Combine(gitdir, "commondir")));
                        string expected = gitdir.Substring(0, at) + "\\.git";
                        if (!Equal(common, expected)) throw new IOException();
                        pin.DirectoryPath(common);
                    } else pin.DirectoryPath(gitdir);
                }
                string head = pin.Text(Path.Combine(gitdir, "HEAD"));
                const string prefix = "ref: refs/heads/";
                if (!head.StartsWith(prefix, StringComparison.Ordinal)) return null;
                string branch = head.Substring(prefix.Length);
                if (branch.Length == 0 || branch.Length > 512 || branch.Contains("..") || branch.IndexOf('\\') >= 0) return null;
                foreach (char ch in branch) if (ch <= 32 || ch == 127) return null;
                return branch;
            }
        }
        return null;
    }
    static string DirectoryInfoParent(string folder) {
        string parent = Path.GetDirectoryName(folder);
        return String.IsNullOrEmpty(parent) || Equal(parent, folder) ? null : parent;
    }
}
'@
    $branch = [RepositoryBranch]::ReadBranch($Cwd)
    if ($null -eq $branch) { exit 1 }
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    [Console]::Out.WriteLine($branch)
    exit 0
} catch { exit 1 }
