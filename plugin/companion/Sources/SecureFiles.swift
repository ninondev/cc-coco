import Foundation
import Darwin

enum SecureFileError: Error { case unsafePath, unsafeFile, tooLarge, io(Int32) }

/// Every operation is relative to the directory opened and verified here.
/// System-owned ancestors are permitted; product directories must belong to this UID.
final class SecureDirectory {
    let fd: Int32
    let ownerUID: uid_t

    init(_ url: URL, create: Bool = false, ownerUID: uid_t = getuid()) throws {
        self.ownerUID = ownerUID
        guard url.isFileURL, url.path.hasPrefix("/") else { throw SecureFileError.unsafePath }
        let components = url.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard !components.isEmpty, !components.contains("..") else { throw SecureFileError.unsafePath }
        var current = Darwin.open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard current >= 0 else { throw SecureFileError.io(errno) }
        do {
            for (index, component) in components.enumerated() {
                var next = openat(current, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                var made = false
                if next < 0 && errno == ENOENT && create {
                    guard mkdirat(current, component, 0o700) == 0 else { throw SecureFileError.io(errno) }
                    made = true
                    next = openat(current, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                }
                guard next >= 0 else { throw SecureFileError.io(errno) }
                var info = stat()
                guard fstat(next, &info) == 0, info.st_mode & S_IFMT == S_IFDIR,
                      info.st_uid == ownerUID || (!made && index < components.count - 1 && info.st_uid == 0) else {
                    close(next); throw SecureFileError.unsafePath
                }
                if made || index == components.count - 1 && create {
                    guard fchmod(next, 0o700) == 0 else { close(next); throw SecureFileError.io(errno) }
                }
                close(current); current = next
            }
            fd = current
        } catch { close(current); throw error }
    }

    deinit { close(fd) }

    private func validName(_ name: String) throws {
        guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\0"), name.utf8.count <= 255 else {
            throw SecureFileError.unsafePath
        }
    }

    static func isRegularOwned(_ info: stat, ownerUID: uid_t) -> Bool {
        info.st_uid == ownerUID && info.st_mode & S_IFMT == S_IFREG && info.st_nlink == 1
    }

    func verify(_ descriptor: Int32) throws -> stat {
        var info = stat()
        guard fstat(descriptor, &info) == 0 else { throw SecureFileError.io(errno) }
        guard Self.isRegularOwned(info, ownerUID: ownerUID) else { throw SecureFileError.unsafeFile }
        return info
    }

    func openFile(_ name: String, flags: Int32 = O_RDONLY, create: Bool = false) throws -> Int32 {
        try validName(name)
        guard flags & (O_TRUNC | O_CREAT) == 0 else { throw SecureFileError.unsafeFile }
        var descriptor = openat(fd, name, flags | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        if descriptor < 0 && errno == ENOENT && create {
            descriptor = openat(fd, name, flags | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC | O_CREAT | O_EXCL, 0o600)
        }
        guard descriptor >= 0 else { throw SecureFileError.io(errno) }
        do { _ = try verify(descriptor); return descriptor }
        catch { close(descriptor); throw error }
    }

    /// Bounded descriptor read: reject size before allocating, then cap each streamed chunk.
    func read(_ name: String, maxBytes: Int) throws -> Data {
        let descriptor = try openFile(name)
        defer { close(descriptor) }
        let info = try verify(descriptor)
        guard info.st_size >= 0, info.st_size <= maxBytes else { throw SecureFileError.tooLarge }
        var result = Data(), buffer = [UInt8](repeating: 0, count: 8_192)
        while true {
            let count = Darwin.read(descriptor, &buffer, min(buffer.count, maxBytes - result.count + 1))
            if count < 0 { if errno == EINTR { continue }; throw SecureFileError.io(errno) }
            if count == 0 { return result }
            guard result.count + count <= maxBytes else { throw SecureFileError.tooLarge }
            result.append(contentsOf: buffer.prefix(count))
        }
    }

    /// Refuse an unsafe destination both before staging and immediately before rename.
    /// A racing leaf replacement can only be unlinked, never opened for writing.
    @discardableResult
    func replace(_ name: String, with data: Data) throws -> stat {
        try validName(name)
        func destination() throws -> stat? {
            var info = stat()
            if fstatat(fd, name, &info, AT_SYMLINK_NOFOLLOW) != 0 {
                if errno == ENOENT { return nil }; throw SecureFileError.io(errno)
            }
            guard Self.isRegularOwned(info, ownerUID: ownerUID) else { throw SecureFileError.unsafeFile }
            return info
        }
        let prior = try destination()
        let temporary = ".s2-" + UUID().uuidString
        let staged = openat(fd, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard staged >= 0 else { throw SecureFileError.io(errno) }
        let stagedInfo: stat
        do { stagedInfo = try verify(staged) }
        catch { close(staged); throw error }
        defer {
            var current = stat()
            if fstatat(fd, temporary, &current, AT_SYMLINK_NOFOLLOW) == 0,
               Self.isRegularOwned(current, ownerUID: ownerUID),
               current.st_dev == stagedInfo.st_dev, current.st_ino == stagedInfo.st_ino {
                unlinkat(fd, temporary, 0)
            }
            close(staged)
        }
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(staged, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0 { if errno == EINTR { continue }; throw SecureFileError.io(errno) }
                guard count > 0 else { throw SecureFileError.io(EIO) }; offset += count
            }
        }
        guard fsync(staged) == 0 else { throw SecureFileError.io(errno) }
        _ = try verify(staged)
        var namedStage = stat()
        guard fstatat(fd, temporary, &namedStage, AT_SYMLINK_NOFOLLOW) == 0,
              Self.isRegularOwned(namedStage, ownerUID: ownerUID),
              namedStage.st_dev == stagedInfo.st_dev, namedStage.st_ino == stagedInfo.st_ino else {
            throw SecureFileError.unsafeFile
        }
        let latest = try destination()
        guard prior?.st_dev == latest?.st_dev, prior?.st_ino == latest?.st_ino else { throw SecureFileError.unsafeFile }
        guard renameat(fd, temporary, fd, name) == 0 else { throw SecureFileError.io(errno) }
        return stagedInfo
    }

    func remove(_ name: String) throws {
        let descriptor: Int32
        do { descriptor = try openFile(name) }
        catch SecureFileError.io(let code) where code == ENOENT { return }
        defer { close(descriptor) }
        let prior = try verify(descriptor)
        var latest = stat()
        guard fstatat(fd, name, &latest, AT_SYMLINK_NOFOLLOW) == 0,
              prior.st_dev == latest.st_dev, prior.st_ino == latest.st_ino,
              Self.isRegularOwned(latest, ownerUID: ownerUID) else {
            throw SecureFileError.unsafeFile
        }
        guard unlinkat(fd, name, 0) == 0 else { throw SecureFileError.io(errno) }
    }

    @discardableResult
    func append(_ name: String, data: Data, maxBytes: Int) throws -> Bool {
        guard data.count <= maxBytes else { throw SecureFileError.tooLarge }
        var previous: Data
        var rotated = false
        do { previous = try read(name, maxBytes: maxBytes) }
        catch SecureFileError.tooLarge { previous = Data(); rotated = true }
        catch SecureFileError.io(let code) where code == ENOENT { previous = Data() }
        if previous.count > maxBytes - data.count { previous = Data(); rotated = true }
        previous.append(data)
        try replace(name, with: previous)
        return rotated
    }
}
