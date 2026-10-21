import { describe, test, expect } from "bun:test";
import { classifyCommand, simpleCommands, lex } from "../../../plugin/hooks/algo/guard";
import type { GuardHit, GuardContext } from "../../../plugin/hooks/algo/guard";

const CTX: GuardContext = { cwd: "/home/user/src/kiwi", home: "/home/user" };
const BRANCH_CTX: GuardContext = { ...CTX, branch: "feature/lark", defaultBranch: "main" };

function hit(cmd: string, ctx: GuardContext = CTX): GuardHit | null {
  return classifyCommand(cmd, ctx);
}
function kind(cmd: string, ctx: GuardContext = CTX): string | null {
  const h = hit(cmd, ctx);
  return h ? h.kind : null;
}
function reason(cmd: string, ctx: GuardContext = CTX): string | null {
  const h = hit(cmd, ctx);
  return h ? h.reason : null;
}

describe("api", () => {
  test("returns null for harmless input", () => { expect(hit("ls -la")).toBeNull(); });
  test("returns null for empty input", () => { expect(hit("")).toBeNull(); });
  test("hit carries kind, reason and command", () => {
    const h = hit("rm -rf /");
    expect(h?.kind).toBe("rm");
    expect(h?.reason).toBe("recursive-delete");
    expect(h?.target).toBe("/");
    expect(h?.command).toBe("rm -rf /");
  });
  test("command is the simple command that matched, spaces normalised", () => {
    expect(hit("npm ci &&   rm   -rf  /  && ls")?.command).toBe("rm -rf /");
  });
  test("command longer than 200 characters is cut", () => {
    const long = "rm -rf / " + "x".repeat(300);
    const c = hit(long)?.command ?? "";
    expect(c.length).toBe(200);
    expect(c.endsWith("…")).toBe(true);
  });
  test("command of a wrapped script is the inner simple command", () => {
    expect(hit("bash -c \x27rm -rf /\x27")?.command).toBe("rm -rf /");
  });
  test("lex is re-exported", () => { expect(typeof lex).toBe("function"); });
  test("simpleCommands returns argv arrays", () => {
    expect(simpleCommands("a b \x27c d\x27 && e f")).toEqual([["a", "b", "c d"], ["e", "f"]]);
  });
  test("simpleCommands drops leading assignments", () => {
    expect(simpleCommands("FOO=1 BAR=2 cmd arg")).toEqual([["cmd", "arg"]]);
  });
  test("simpleCommands drops assignments-only segments", () => {
    expect(simpleCommands("FOO=1")).toEqual([]);
  });
  test("never throws on hostile input", () => {
    expect(() => hit("\x27\x27\x27\"\"\"$((")).not.toThrow();
    expect(() => hit("\\u0000\\u0001")).not.toThrow();
  });
});

describe("structure descent", () => {
  test("subshell", () => { expect(kind("(rm -rf /)")).toBe("rm"); });
  test("brace group", () => { expect(kind("{ rm -rf /; }")).toBe("rm"); });
  test("nested subshell", () => { expect(kind("( ( rm -rf / ) )")).toBe("rm"); });
  test("command substitution", () => { expect(kind("echo $(rm -rf /)")).toBe("rm"); });
  test("backticks", () => { expect(kind("echo `rm -rf /`")).toBe("rm"); });
  test("nested command substitution", () => { expect(kind("echo $(x $(rm -rf /))")).toBe("rm"); });
  test("if body", () => { expect(kind("if [ -x / ]; then rm -rf /; fi")).toBe("rm"); });
  test("if with else", () => { expect(kind("if true; then echo hi; else rm -rf /; fi")).toBe("rm"); });
  test("elif body", () => { expect(kind("if false; then echo a; elif true; then rm -rf /; else echo b; fi")).toBe("rm"); });
  test("for body", () => { expect(kind("for f in *; do rm -rf /; done")).toBe("rm"); });
  test("while body", () => { expect(kind("while read l; do rm -rf /; done")).toBe("rm"); });
  test("until body", () => { expect(kind("until false; do rm -rf /; done")).toBe("rm"); });
  test("case arm", () => { expect(kind("case x in a) rm -rf /;; esac")).toBe("rm"); });
  test("first hit in command order wins", () => {
    expect(hit("git reset --hard && rm -rf /")?.reason).toBe("hard-reset");
    expect(hit("rm -rf / && git reset --hard")?.reason).toBe("recursive-delete");
  });
  test("pipeline stages are separate commands", () => {
    expect(kind("cat f | xargs rm -rf")).toBeNull();
    expect(kind("true | rm -rf /")).toBe("rm");
  });
});

describe("wrappers", () => {
  test("sudo", () => { expect(kind("sudo rm -rf /")).toBe("rm"); });
  test("sudo with options and -u", () => { expect(kind("sudo -u root rm -rf /")).toBe("rm"); });
  test("sudo -E and --", () => { expect(kind("sudo -E -- rm -rf /")).toBe("rm"); });
  test("sudo -n", () => { expect(kind("sudo -n rm -rf /")).toBe("rm"); });
  test("doas", () => { expect(kind("doas rm -rf /")).toBe("rm"); });
  test("doas -u", () => { expect(kind("doas -u root rm -rf /")).toBe("rm"); });
  test("env with assignments", () => { expect(kind("env DIR=/ rm -rf $DIR")).toBe("rm"); });
  test("env -u VAR", () => { expect(kind("env -u X rm -rf /")).toBe("rm"); });
  test("nohup", () => { expect(kind("nohup rm -rf /")).toBe("rm"); });
  test("time", () => { expect(kind("time rm -rf /")).toBe("rm"); });
  test("command", () => { expect(kind("command rm -rf /")).toBe("rm"); });
  test("exec", () => { expect(kind("exec rm -rf /")).toBe("rm"); });
  test("builtin", () => { expect(kind("builtin rm -rf /")).toBe("rm"); });
  test("nice", () => { expect(kind("nice rm -rf /")).toBe("rm"); });
  test("nice -n 5", () => { expect(kind("nice -n 5 rm -rf /")).toBe("rm"); });
  test("ionice", () => { expect(kind("ionice -c 2 rm -rf /")).toBe("rm"); });
  test("timeout", () => { expect(kind("timeout 10 rm -rf /")).toBe("rm"); });
  test("timeout with duration and options", () => { expect(kind("timeout -k 5 30s rm -rf /")).toBe("rm"); });
  test("stdbuf", () => { expect(kind("stdbuf -o0 rm -rf /")).toBe("rm"); });
  test("caffeinate", () => { expect(kind("caffeinate -i rm -rf /")).toBe("rm"); });
  test("watch runs its command string", () => { expect(kind("watch rm -rf /")).toBe("rm"); });
  test("watch -n 2", () => { expect(kind("watch -n 2 rm -rf /")).toBe("rm"); });
  test("xargs passes through the command", () => { expect(kind("ls | xargs rm -rf")).toBeNull(); });
  test("stacked wrappers", () => { expect(kind("sudo nice -n 3 timeout 5 rm -rf /")).toBe("rm"); });
  test("sudo git reset --hard", () => { expect(reason("sudo git reset --hard")).toBe("hard-reset"); });
  test("ssh is not classified", () => { expect(kind("ssh alpha.lark.dev rm -rf /")).toBeNull(); });
  test("ssh with a quoted script", () => { expect(kind("ssh beta \x27rm -rf /\x27")).toBeNull(); });
  test("docker exec is not classified", () => { expect(kind("docker exec web rm -rf /")).toBeNull(); });
  test("kubectl exec is not classified", () => { expect(kind("kubectl exec pod -- rm -rf /")).toBeNull(); });
  test("bash -c parses the string", () => { expect(kind("bash -c \x27rm -rf /\x27")).toBe("rm"); });
  test("sh -c", () => { expect(kind("sh -c \x27rm -rf /\x27")).toBe("rm"); });
  test("zsh -c with options before -c", () => { expect(kind("zsh -f -c \x27rm -rf /\x27")).toBe("rm"); });
  test("three levels deep", () => {
    // bash -c "bash -c \x27bash -c \"rm -rf /\"\x27" -- nesting checked with bash
    const q = String.fromCharCode(39);
    const d = String.fromCharCode(34);
    const inner = "bash -c " + q + "bash -c " + "\\" + d + "rm -rf /" + "\\" + d + q;
    expect(kind("bash -c " + d + inner + d)).toBe("rm");
  });
  test("four levels deep is not parsed", () => {
    const q = String.fromCharCode(39);
    const d = String.fromCharCode(34);
    const inner = "bash -c " + q + "bash -c " + "\\" + d + "bash -c " + "\\" + "\\" + d +
      "rm -rf /" + "\\" + "\\" + d + "\\" + d + q;
    expect(kind("bash -c " + d + inner + d)).toBeNull();
  });
  test("eval parses its string", () => { expect(kind("eval \x27rm -rf /\x27")).toBe("rm"); });
  test("eval inside bash -c", () => { expect(kind("bash -c \x27eval \"rm -rf /\"\x27")).toBe("rm"); });
  test("plain bash without -c is a normal command", () => { expect(kind("bash script.sh")).toBeNull(); });
});

describe("expansion", () => {
  test("tilde expands to home", () => { expect(reason("rm -rf ~")).toBe("recursive-delete"); });
  test("tilde slash expands under home", () => { expect(reason("rm -rf ~/src")).toBe("recursive-delete"); });
  test("dollar HOME", () => { expect(reason("rm -rf $HOME")).toBe("recursive-delete"); });
  test("braced HOME", () => { expect(reason("rm -rf ${HOME}")).toBe("recursive-delete"); });
  test("home equal to cwd is still home itself", () => {
    // the rule lists "~ or home itself" apart from containment, so it flags
    const c: GuardContext = { cwd: "/home/user/src/kiwi", home: "/home/user/src/kiwi" };
    expect(kind("rm -rf ~", c)).toBe("rm");
    expect(kind("rm -rf ~/src/kiwi/node_modules", c)).toBeNull();
  });
  test("dollar PWD is cwd", () => { expect(reason("rm -rf $PWD")).toBe("recursive-delete"); });
  test("dollar TMPDIR resolves when given", () => {
    const c: GuardContext = { ...CTX, tmpdir: "/var/folders/zz" };
    expect(kind("rm -rf $TMPDIR/scratch", c)).toBeNull();
  });
  test("assignment before use", () => { expect(kind("DIR=/; rm -rf $DIR")).toBe("rm"); });
  test("assignment with quotes", () => { expect(kind("DIR=~/x; rm -rf $DIR")).toBeNull(); });
  test("unknown variable word is not a target", () => { expect(kind("rm -rf $BUILD")).toBeNull(); });
  test("unknown variable mixed into a word", () => { expect(kind("rm -rf /usr/$X")).toBeNull(); });
  test("unset variable shape VAR slash star", () => {
    expect(reason("rm -rf \"$VAR/*\"")).toBe("recursive-delete");
  });
  test("unset variable shape braced VAR slash", () => {
    expect(reason("rm -rf \"${VAR}/\"")).toBe("recursive-delete");
  });
  test("target is exactly as typed", () => {
    expect(hit("rm -rf \"$VAR/*\"")?.target).toBe("\"$VAR/*\"");
  });
  test("single quotes do not expand, so the exact shape does not apply", () => {
    // the brief writes the four shapes in double quotes; a single quoted
    // word is the literal folder $VAR and can never become /
    expect(kind("rm -rf \x27$VAR/*\x27")).toBeNull();
  });
  test("the unset shape needs recursive and force", () => { expect(kind("rm -r \"$VAR/\"")).toBeNull(); });
  test("HOME in the unset shape is already resolved", () => {
    const c: GuardContext = { cwd: "/home/user", home: "/home/user" };
    expect(kind("rm -rf \"$HOME/*\"", c)).toBeNull();
  });
  test("PWD in the unset shape is already resolved", () => {
    const c: GuardContext = { cwd: "/home/user", home: "/home/user" };
    expect(kind("rm -rf \"${PWD}/*\"", c)).toBeNull();
  });
  test("a variable assigned earlier does not use the shape", () => {
    expect(kind("VAR=dist; rm -rf \"$VAR/*\"")).toBeNull();
  });
  test("assignment in an env wrapper counts", () => {
    expect(kind("VAR=dist env X=1 rm -rf \"$VAR/*\"")).toBeNull();
  });
  test("a quoted reference closed before the slash is the same word to the shell", () => {
    // rm -rf "$VAR"/ with VAR unset at run time is rm -rf /, exactly like the four
    // shapes named in the brief, so the shape accepts the quote closing early
    expect(reason("rm -rf \"\$VAR\"/")).toBe("recursive-delete");
    expect(reason("rm -rf \"\${VAR}\"/*")).toBe("recursive-delete");
    expect(hit("rm -rf \"\$VAR\"/")?.target).toBe("\"\$VAR\"/");
  });
  test("unquoted variable shape is not the exact shape", () => { expect(kind("rm -rf $VAR/*")).toBeNull(); });
});

describe("path resolution", () => {
  test("relative path against cwd", () => { expect(kind("rm -rf ../../etc")).toBe("rm"); });
  test("dot dot stays inside cwd when possible", () => { expect(kind("rm -rf ../..")).toBe("rm"); });
  test("inside cwd is contained", () => { expect(kind("rm -rf node_modules")).toBeNull(); });
  test("nested inside cwd", () => { expect(kind("rm -rf ./dist/../build/x")).toBeNull(); });
  test("repeated slashes collapse", () => { expect(kind("rm -rf //tmp//x")).toBeNull(); });
  test("under tmp is contained", () => { expect(kind("rm -rf /tmp/scratch")).toBeNull(); });
  test("tmp itself is not contained", () => { expect(kind("rm -rf /tmp")).toBe("rm"); });
  test("under var folders is contained", () => { expect(kind("rm -rf /var/folders/ab/c123/T")).toBeNull(); });
  test("private tmp under macOS", () => { expect(kind("rm -rf /private/tmp/junk")).toBeNull(); });
  test("tmpdir from context", () => {
    expect(kind("rm -rf /srv/scratch/x", { ...CTX, tmpdir: "/srv/scratch" })).toBeNull();
    expect(kind("rm -rf /srv/scratch", { ...CTX, tmpdir: "/srv/scratch" })).toBe("rm");
  });
  test("cwd itself is flagged", () => { expect(reason("rm -rf .")).toBe("recursive-delete"); });
  test("dot dot operand", () => { expect(reason("rm -rf ..")).toBe("recursive-delete"); });
  test("star at cwd", () => { expect(reason("rm -rf *")).toBe("recursive-delete"); });
  test("dot star at cwd", () => { expect(reason("rm -rf .*")).toBe("recursive-delete"); });
  test("git folder anywhere", () => { expect(reason("rm -rf node_modules .git")).toBe("recursive-delete"); });
  test("git folder deep", () => { expect(reason("rm -rf sub/.git/objects")).toBe("recursive-delete"); });
  test("uncontained path", () => { expect(reason("rm -rf /usr/local/cellar")).toBe("recursive-delete"); });
  test("first offending target is reported", () => {
    expect(hit("rm -rf node_modules /usr .git")?.target).toBe("/usr");
  });
});

describe("windows paths", () => {
  const W: GuardContext = { cwd: "C:\\\\Users\\\\user\\\\src\\\\kiwi", home: "C:\\\\Users\\\\user", platform: "windows" };
  test("backslash separators", () => { expect(kind("rm -rf C:\\\\Windows", W)).toBe("rm"); });
  test("case insensitive", () => { expect(kind("rm -rf c:\\\\windows\\\\system32", W)).toBe("rm"); });
  test("inside cwd on windows", () => { expect(kind("rm -rf node_modules", W)).toBeNull(); });
  test("drive root is flagged", () => { expect(reason("rm -rf C:\\\\", W)).toBe("recursive-delete"); });
  test("userprofile percent form", () => { expect(reason("rm -rf %USERPROFILE%", W)).toBe("recursive-delete"); });
  test("userprofile dollar env form", () => { expect(reason("rm -rf $env:USERPROFILE", W)).toBe("recursive-delete"); });
  test("forward slashes work as separators", () => { expect(kind("rm -rf C:/Windows", W)).toBe("rm"); });
  test("relative windows path", () => { expect(kind("rm -rf ..\\\\..\\\\Windows", W)).toBe("rm"); });
});

describe("rules: rm", () => {
  test("recursive and force in any shape", () => {
    for (const c of ["rm -rf /", "rm -fr /", "rm -Rf /", "rm -r -f /", "rm -f -r /", "rm --recursive --force /"]) {
      expect(reason(c)).toBe("recursive-delete");
    }
  });
  test("recursive without force is not enough", () => {
    expect(kind("rm -r /")).toBeNull();
    expect(kind("rm -f /")).toBeNull();
    expect(kind("rm -r node_modules")).toBeNull();
  });
  test("no preserve root never makes a delete safe", () => {
    expect(reason("rm -rf --no-preserve-root /")).toBe("recursive-delete");
    expect(reason("rm --no-preserve-root -r -f /")).toBe("recursive-delete");
  });
  test("options after the target still count", () => {
    expect(reason("rm / -rf")).toBe("recursive-delete");
    expect(kind("rm node_modules -rf")).toBeNull();
  });
  test("git folder is the history", () => { expect(hit("rm -rf .git")?.target).toBe(".git"); });
  test("tmp folders themselves are flagged, named folders under them are not", () => {
    expect(kind("rm -rf /tmp/kiwi")).toBeNull();
    expect(kind("rm -rf /tmp/kiwi/deep")).toBeNull();
    expect(reason("rm -rf /tmp")).toBe("recursive-delete");
    expect(reason("rm -rf /private/tmp")).toBe("recursive-delete");
    expect(reason("rm -rf /var/folders")).toBe("recursive-delete");
  });
  test("quoted targets are reported as typed", () => {
    expect(hit("rm -rf '/usr'")?.target).toBe("'/usr'");
    expect(hit("rm -rf \"/usr\"")?.target).toBe("\"/usr\"");
  });
});

describe("rules: find and shred", () => {
  test("delete on an uncontained root", () => {
    expect(reason("find / -name x -delete")).toBe("find-delete");
    expect(reason("find ~ -delete")).toBe("find-delete");
    expect(reason("find /etc -delete")).toBe("find-delete");
    expect(hit("find /usr -name x -delete")?.target).toBe("/usr");
  });
  test("delete on contained roots stays quiet", () => {
    expect(kind("find . -name '*.pyc' -delete")).toBeNull();
    expect(kind("find src -name '*.log' -delete")).toBeNull();
    expect(kind("find /tmp/kiwi -delete")).toBeNull();
  });
  test("exec rm needs recursion", () => {
    expect(reason("find / -exec rm -rf {} +")).toBe("find-delete");
    expect(reason("find / -execdir rm -r {} \;")).toBe("find-delete");
    expect(kind("find . -exec rm {} \;")).toBeNull();
    expect(kind("find / -exec rm {} \;")).toBeNull();
  });
  test("shred", () => {
    expect(reason("shred -u /etc/passwd")).toBe("shred");
    expect(reason("shred --remove wren.key")).toBeNull();
    expect(reason("shred -u /dev/sda")).toBe("shred");
    expect(kind("shred -u notes.txt")).toBeNull();
  });
});

describe("rules: powershell and cmd", () => {
  const W: GuardContext = { cwd: "C:\\home\\user\\src\\kiwi", home: "C:\\home\\user", platform: "windows" };
  test("remove item with abbreviation", () => {
    expect(reason("Remove-Item -Recurse -Force C:\\Windows", W)).toBe("recursive-delete");
    expect(reason("Remove-Item -r -fo C:\\Windows", W)).toBe("recursive-delete");
    expect(reason("rm -Recurse -Force C:\\Windows", W)).toBe("recursive-delete");
    expect(reason("ri -r -f C:\\Windows", W)).toBe("recursive-delete");
    expect(reason("del -Recurse -Force C:\\Windows", W)).toBe("recursive-delete");
    expect(reason("rd -Recurse -Force C:\\Windows", W)).toBe("recursive-delete");
    expect(kind("Remove-Item -Recurse C:\\Windows", W)).toBeNull();
    expect(kind("Remove-Item -Force notes.txt", W)).toBeNull();
    expect(kind("Remove-Item -Recurse -Force .\\dist", W)).toBeNull();
  });
  test("cmd switches in any order", () => {
    expect(reason("rd /s /q C:\\sysroot", W)).toBe("recursive-delete");
    expect(reason("rmdir /q /s C:\\sysroot", W)).toBe("recursive-delete");
    expect(reason("del /f /s /q C:\\sysroot", W)).toBe("recursive-delete");
    expect(kind("rd /s C:\\sysroot", W)).toBeNull();
    expect(kind("del /f notes.txt", W)).toBeNull();
  });
});

describe("rules: git push", () => {
  test("force to a protected branch", () => {
    for (const b of ["main", "master", "trunk", "develop", "production", "release/1.0"]) {
      expect(reason("git push origin " + b + " --force")).toBe("force-push");
      expect(reason("git push -f origin " + b)).toBe("force-push");
      expect(reason("git push origin +" + b)).toBe("force-push");
      expect(reason("git push origin HEAD:" + b + " --force")).toBe("force-push");
      expect(reason("git push origin refs/heads/" + b + " -f")).toBe("force-push");
    }
  });
  test("branch is reported", () => {
    expect(hit("git push -f origin master")?.branch).toBe("master");
    expect(hit("git push origin +release/2.0")?.branch).toBe("release/2.0");
    expect(hit("git push origin HEAD:main -f")?.branch).toBe("main");
  });
  test("default branch from context is protected", () => {
    const c: GuardContext = { ...CTX, defaultBranch: "kiwi-main" };
    expect(reason("git push origin kiwi-main --force", c)).toBe("force-push");
    expect(kind("git push origin kiwi-main", c)).toBeNull();
  });
  test("no refspec uses the context branch", () => {
    const onMain: GuardContext = { ...CTX, branch: "main" };
    expect(reason("git push -f", onMain)).toBe("force-push");
    expect(reason("git push --force origin", onMain)).toBe("force-push");
    expect(kind("git push -f", BRANCH_CTX)).toBeNull();
  });
  test("force to another branch stays quiet", () => {
    expect(kind("git push -f origin lark-fix")).toBeNull();
    expect(kind("git push origin +lark-fix")).toBeNull();
  });
  test("force with lease is not a force push", () => {
    expect(kind("git push --force-with-lease origin main")).toBeNull();
    expect(kind("git push --force-with-lease=alpha main")).toBeNull();
    expect(kind("git push --force-if-includes origin main")).toBeNull();
  });
  test("force with lease next to a real force still flags", () => {
    expect(reason("git push origin main --force-with-lease --force")).toBe("force-push");
  });
  test("push delete", () => {
    expect(reason("git push origin --delete main")).toBe("push-delete");
    expect(reason("git push origin :master")).toBe("push-delete");
    expect(hit("git push origin :main")?.branch).toBe("main");
    expect(kind("git push origin :lark-fix")).toBeNull();
    expect(kind("git push origin --delete lark-fix")).toBeNull();
  });
  test("mirror push", () => {
    expect(reason("git push --mirror")).toBe("mirror-push");
    expect(reason("git push origin --mirror")).toBe("mirror-push");
    expect(kind("git push origin main")).toBeNull();
  });
});

describe("rules: git worktree", () => {
  test("hard reset", () => {
    expect(reason("git reset --hard")).toBe("hard-reset");
    expect(reason("git reset --hard HEAD~2")).toBe("hard-reset");
    expect(reason("git reset --hard abc1234")).toBe("hard-reset");
    expect(reason("git reset -q --hard")).toBe("hard-reset");
    expect(kind("git reset --soft HEAD~1")).toBeNull();
    expect(kind("git reset --mixed HEAD")).toBeNull();
    expect(kind("git reset HEAD~1")).toBeNull();
    expect(kind("git reset")).toBeNull();
  });
  test("checkout discards", () => {
    expect(reason("git checkout -- .")).toBe("discard-worktree");
    expect(reason("git checkout -- src/alpha.ts")).toBe("discard-worktree");
    expect(reason("git checkout .")).toBe("discard-worktree");
    expect(reason("git checkout -f")).toBe("discard-worktree");
    expect(reason("git checkout --force")).toBe("discard-worktree");
    expect(reason("git checkout HEAD -- src/alpha.ts")).toBe("discard-worktree");
    expect(kind("git checkout main")).toBeNull();
    expect(kind("git checkout -b lark-fix")).toBeNull();
    expect(kind("git checkout -t origin/lark-fix")).toBeNull();
    expect(kind("git checkout lark-fix -- src/alpha.ts")).not.toBeNull();
  });
  test("restore and switch", () => {
    expect(reason("git restore .")).toBe("discard-worktree");
    expect(reason("git restore src/alpha.ts")).toBe("discard-worktree");
    expect(reason("git restore --worktree src/alpha.ts")).toBe("discard-worktree");
    expect(kind("git restore --staged .")).toBeNull();
    expect(kind("git restore --staged --source=HEAD~1 src/alpha.ts")).toBeNull();
    expect(reason("git switch -f main")).toBe("discard-worktree");
    expect(reason("git switch --discard-changes lark-fix")).toBe("discard-worktree");
    expect(kind("git switch main")).toBeNull();
    expect(kind("git switch -c lark-fix")).toBeNull();
  });
  test("clean", () => {
    expect(reason("git clean -fd")).toBe("clean-force");
    expect(reason("git clean -f -x")).toBe("clean-force");
    expect(reason("git clean -ffd")).toBe("clean-force");
    expect(kind("git clean -n")).toBeNull();
    expect(kind("git clean -nd")).toBeNull();
    expect(kind("git clean -i")).toBeNull();
    expect(kind("git clean -fdi")).toBeNull();
    expect(kind("git clean -f")).toBeNull();
  });
  test("stash", () => {
    expect(reason("git stash drop")).toBe("stash-drop");
    expect(reason("git stash drop stash@{2}")).toBe("stash-drop");
    expect(reason("git stash clear")).toBe("stash-clear");
    expect(kind("git stash pop")).toBeNull();
    expect(kind("git stash apply")).toBeNull();
    expect(kind("git stash push -m wip")).toBeNull();
  });
  test("history", () => {
    expect(reason("git filter-branch --env-filter x main")).toBe("history-rewrite");
    expect(reason("git filter-repo --force")).toBe("history-rewrite");
    expect(kind("git reflog expire --expire=30.days --all")).toBeNull();
    expect(kind("git reflog show")).toBeNull();
    expect(kind("git log --oneline")).toBeNull();
  });
  test("reflog expire now", () => {
    expect(reason("git reflog expire --expire=now --all")).toBe("reflog-expire");
    expect(reason("git reflog expire --expire-unreachable=now --all")).toBe("reflog-expire");
  });
});

describe("rules: permissions", () => {
  test("world writable modes", () => {
    for (const m of ["777", "0777", "a+rwx", "ugo+rwx", "o+w", "a+w"]) {
      expect(reason("chmod -R " + m + " /srv/kiwi")).toBe("world-writable");
      expect(reason("chmod --recursive " + m + " /srv/kiwi")).toBe("world-writable");
    }
  });
  test("target as typed", () => { expect(hit("chmod -R 777 /etc")?.target).toBe("/etc"); });
  test("cwd itself is flagged", () => { expect(reason("chmod -R 777 .")).toBe("world-writable"); });
  test("safe modes and contained paths", () => {
    expect(kind("chmod -R 755 .")).toBeNull();
    expect(kind("chmod -R 644 dist")).toBeNull();
    expect(kind("chmod -R 777 dist")).toBeNull();
    expect(kind("chmod 777 /etc")).toBeNull();
    expect(kind("chmod o+w notes.txt")).toBeNull();
  });
  test("chown and chgrp recursion", () => {
    expect(reason("chown -R root /usr")).toBe("owner-change");
    expect(reason("chown -R root:wheel /Library")).toBe("owner-change");
    expect(reason("chgrp -R staff /opt")).toBe("owner-change");
    expect(kind("chown -R alpha:lark dist")).toBeNull();
    expect(kind("chown alpha notes.txt")).toBeNull();
    expect(reason("chown -R root ~")).toBe("owner-change");
    expect(reason("chown -R root /")).toBe("owner-change");
  });
});

describe("rules: disks", () => {
  test("dd to a device", () => {
    expect(reason("dd if=kiwi.img of=/dev/sda")).toBe("device-write");
    expect(reason("dd if=/dev/zero of=/dev/nvme0n1 bs=4M")).toBe("device-write");
    expect(reason("sudo dd if=x of=/dev/rdisk0")).toBe("device-write");
    expect(hit("dd of=/dev/sdb if=kiwi.img")?.target).toBe("/dev/sdb");
    expect(kind("dd if=/dev/zero of=/tmp/kiwi.img")).toBeNull();
    expect(kind("dd if=kiwi.img of=notes.img")).toBeNull();
  });
  test("redirection to a raw device", () => {
    expect(reason("cat kiwi.img > /dev/sda")).toBe("device-write");
    expect(reason("echo x > /dev/nvme0n1")).toBe("device-write");
    expect(reason(": > /dev/disk1")).toBe("device-write");
    expect(reason("dd if=x of=y >| /dev/sda")).toBe("device-write");
    expect(kind("cat kiwi.img > /dev/null")).toBeNull();
    expect(kind("echo x > /tmp/kiwi.txt")).toBeNull();
  });
  test("filesystem makers", () => {
    for (const mk of ["mkfs", "mkfs.ext4", "mkfs.vfat", "mkfs.xfs", "mkfs.btrfs", "mkfs.apfs", "newfs_msdos", "newfs_hfs"]) {
      expect(reason(mk + " /dev/sdb1")).toBe("filesystem");
    }
    expect(hit("mkfs --help")?.target).toBeUndefined();
    expect(reason("mkfs.ext4 /dev/sdb1")).toBe("filesystem");
  });
  test("diskutil verbs", () => {
    expect(reason("diskutil eraseDisk APFS Kiwi /dev/disk0")).toBe("filesystem");
    expect(reason("diskutil eraseVolume JHFS+ Mango /dev/disk2s1")).toBe("filesystem");
    expect(reason("diskutil reformat /dev/disk3")).toBe("filesystem");
    expect(reason("diskutil zeroDisk /dev/disk1")).toBe("filesystem");
    expect(reason("diskutil randomDisk 1 /dev/disk1")).toBe("filesystem");
    expect(reason("diskutil secureErase 2 /dev/disk0")).toBe("filesystem");
    expect(reason("diskutil partitionDisk /dev/disk0 2 APFS Kiwi APFS Plum")).toBe("partition");
    expect(kind("diskutil list")).toBeNull();
    expect(kind("diskutil info /dev/disk0")).toBeNull();
    expect(kind("diskutil unmountDisk /dev/disk0")).toBeNull();
  });
  test("partition tools", () => {
    expect(reason("wipefs -a /dev/sdb")).toBe("device-write");
    expect(kind("wipefs /dev/sdb")).toBeNull();
    expect(kind("wipefs --help")).toBeNull();
    expect(reason("sgdisk -Z /dev/sda")).toBe("partition");
    expect(reason("sgdisk --zap-all /dev/sda")).toBe("partition");
    expect(kind("sgdisk -p /dev/sda")).toBeNull();
    expect(reason("parted -s /dev/sdb mklabel gpt")).toBe("partition");
    expect(reason("parted /dev/sdb rm 1")).toBe("partition");
    expect(kind("parted /dev/sdb print")).toBeNull();
    expect(kind("fdisk -l /dev/sdb")).toBeNull();
  });
  test("windows volume tools", () => {
    const W: GuardContext = { ...CTX, platform: "windows" };
    expect(reason("Format-Volume -DriveLetter D", W)).toBe("filesystem");
    expect(reason("Format-Volume -FileSystem NTFS -DriveLetter E", W)).toBe("filesystem");
    expect(reason("Clear-Disk -Number 1", W)).toBe("device-write");
    expect(reason("format D: /FS:NTFS", W)).toBe("filesystem");
    expect(kind("Get-Volume", W)).toBeNull();
  });
});

describe("rules: databases", () => {
  test("drop database and schema", () => {
    expect(hit("psql -c 'DROP DATABASE shop'")?.target).toBe("shop");
    expect(reason("psql -c 'drop database shop'")).toBe("drop-database");
    expect(reason("psql -c 'DROP SCHEMA billing'")).toBe("drop-database");
    expect(reason("psql -c 'DROP DATABASE IF EXISTS shop'")).toBe("drop-database");
    expect(reason("psql --command 'DROP DATABASE shop'")).toBe("drop-database");
    expect(reason("mysql --execute 'DROP DATABASE shop'")).toBe("drop-database");
    expect(reason("mysql -e 'DROP DATABASE shop'")).toBe("drop-database");
    expect(reason("sqlcmd --query 'DROP DATABASE shop'")).toBe("drop-database");
    expect(reason("sqlcmd -Q 'DROP DATABASE shop'")).toBe("drop-database");
    expect(reason("clickhouse-client -q 'DROP DATABASE shop'")).toBe("drop-database");
    expect(reason("cockroach sql -e 'DROP DATABASE shop'")).toBe("drop-database");
  });
  test("drop table, truncate, delete all", () => {
    expect(hit("mysql -e 'DROP TABLE orders'")?.target).toBe("orders");
    expect(reason("mariadb -e 'DROP TABLE billing.invoices'")).toBe("drop-table");
    expect(reason("sqlite3 shop.sqlite 'DROP TABLE users'")).toBe("drop-table");
    expect(reason("duckdb shop.db 'DROP TABLE orders'")).toBe("drop-table");
    expect(reason("psql -c 'TRUNCATE TABLE orders'")).toBe("truncate");
    expect(reason("psql -c 'TRUNCATE orders'")).toBe("truncate");
    expect(reason("psql -c 'TRUNCATE TABLE orders RESTART IDENTITY'")).toBe("truncate");
    expect(reason("psql -c 'DELETE FROM orders'")).toBe("delete-all-rows");
    expect(reason("psql -c 'DELETE FROM orders; -- clean'")).toBe("delete-all-rows");
    expect(kind("psql -c 'DELETE FROM orders WHERE id = 2'")).toBeNull();
    expect(kind("psql -c 'DELETE FROM orders where id = 2'")).toBeNull();
    const nl = String.fromCharCode(10);
    expect(kind("psql -c 'DELETE FROM orders" + nl + "WHERE id = 2'")).toBeNull();
    expect(kind("psql -c 'DELETE FROM orders" + nl + "  WHERE id = 2'")).toBeNull();
  });
  test("several statements split on the semicolon", () => {
    expect(reason("psql -c 'SELECT 1; TRUNCATE orders'")).toBe("truncate");
    expect(reason("psql -c 'SELECT 1; DROP TABLE orders'")).toBe("drop-table");
    expect(kind("psql -c 'SELECT 1; DELETE FROM orders WHERE id = 1'")).toBeNull();
  });
  test("statements inside strings and comments are respected", () => {
    expect(kind("psql -c 'SELECT ''DROP TABLE orders'''")).toBeNull();
    expect(kind("psql -c '-- DROP TABLE orders'")).toBeNull();
    expect(kind("psql -c '/* DROP TABLE orders */ SELECT 1'")).toBeNull();
    expect(reason("psql -c '/* note */ DROP TABLE orders'")).toBe("drop-table");
  });
  test("sql in a heredoc fed to a database client", () => {
    const q = String.fromCharCode(39);
    const dq = String.fromCharCode(34);
    const nl = String.fromCharCode(10);
    expect(reason("psql -d shop <<" + q + "SQL" + q + nl + "DROP DATABASE shop;" + nl + "SQL")).toBe("drop-database");
    expect(reason("psql -d shop <<-'SQL'" + nl + "\tDROP TABLE orders;" + nl + "SQL")).toBe("drop-table");
    expect(reason("mysql shop <<" + dq + "SQL" + dq + nl + "TRUNCATE orders;" + nl + "SQL")).toBe("truncate");
    expect(kind("cat <<'EOF'" + nl + "DROP DATABASE shop;" + nl + "EOF")).toBeNull();
    expect(kind("tee notes.txt <<'EOF'" + nl + "rm -rf /" + nl + "EOF")).toBeNull();
  });
  test("stores", () => {
    expect(reason("redis-cli FLUSHALL")).toBe("flush-store");
    expect(reason("redis-cli FLUSHDB")).toBe("flush-store");
    expect(reason("redis-cli flushall")).toBe("flush-store");
    expect(reason("redis-cli -h alpha.lark.dev -n 2 FLUSHALL")).toBe("flush-store");
    expect(kind("redis-cli --scan")).toBeNull();
    expect(kind("redis-cli del kiwi:key")).toBeNull();
    expect(reason("mongosh --eval 'db.dropDatabase()'")).toBe("drop-database");
    expect(hit("mongosh --eval 'db.users.drop()'")?.target).toBe("users");
    expect(reason("mongo shop --eval 'db.orders.drop()'")).toBe("drop-table");
    expect(kind("mongosh --eval 'db.orders.count()'")).toBeNull();
    expect(kind("mongosh --eval 'db.orders.dropIndex({id:1})'")).toBeNull();
  });
});

describe("rules: infrastructure", () => {
  test("terraform and pulumi", () => {
    expect(reason("terraform destroy")).toBe("terraform-destroy");
    expect(reason("terraform destroy -auto-approve")).toBe("terraform-destroy");
    expect(reason("terraform apply -destroy")).toBe("terraform-destroy");
    expect(reason("terraform apply -destroy -auto-approve")).toBe("terraform-destroy");
    expect(reason("terraform destroy -target=aws_instance.kiwi")).toBe("terraform-destroy");
    expect(kind("terraform plan")).toBeNull();
    expect(kind("terraform apply")).toBeNull();
    expect(kind("terraform apply -auto-approve")).toBeNull();
    expect(reason("pulumi destroy")).toBe("pulumi-destroy");
    expect(reason("pulumi destroy --yes -s staging")).toBe("pulumi-destroy");
    expect(kind("pulumi up --yes")).toBeNull();
    expect(kind("pulumi preview")).toBeNull();
  });
  test("kubectl namespaces and everything", () => {
    expect(hit("kubectl delete namespace production")?.target).toBe("production");
    expect(hit("kubectl delete ns staging")?.target).toBe("staging");
    expect(reason("kubectl delete namespaces kiwi")).toBe("kubectl-delete");
    expect(reason("kubectl delete pods --all")).toBe("kubectl-delete");
    expect(reason("kubectl delete deployments -A --all")).toBe("kubectl-delete");
    expect(kind("kubectl delete pod kiwi-web-1")).toBeNull();
    expect(kind("kubectl delete -f manifest.yaml")).toBeNull();
    expect(kind("kubectl get pods --all")).toBeNull();
  });
  test("kubectl takes the resource and name joined by a slash", () => {
    // delete ns/kiwi is the same command as delete namespace kiwi
    expect(hit("kubectl delete ns/kiwi")?.target).toBe("kiwi");
    expect(hit("kubectl delete namespace/kiwi-staging")?.target).toBe("kiwi-staging");
    expect(hit("kubectl -n staging delete ns/kiwi")?.target).toBe("kiwi");
    expect(kind("kubectl delete pod/kiwi-web-1")).toBeNull();
    expect(kind("kubectl delete deploy/kiwi-api")).toBeNull();
  });
  test("docker volumes", () => {
    expect(reason("docker volume prune")).toBe("docker-volumes");
    expect(reason("docker volume rm kiwi_data")).toBe("docker-volumes");
    expect(reason("docker system prune --volumes")).toBe("docker-volumes");
    expect(kind("docker system prune")).toBeNull();
    expect(kind("docker image prune -a")).toBeNull();
    expect(kind("docker volume ls")).toBeNull();
    expect(kind("docker compose down -v")).toBeNull();
  });
  test("object stores", () => {
    expect(hit("aws s3 rm s3://kiwi-shop --recursive")?.target).toBe("s3://kiwi-shop");
    expect(reason("aws s3 rb s3://kiwi-shop --force")).toBe("bucket-delete");
    expect(kind("aws s3 rm s3://kiwi-shop/notes.txt")).toBeNull();
    expect(kind("aws s3 ls s3://kiwi-shop")).toBeNull();
    expect(reason("gsutil rm -r gs://kiwi-shop")).toBe("bucket-delete");
    expect(kind("gsutil rm gs://kiwi-shop/notes.txt")).toBeNull();
    expect(reason("gcloud storage rm -r gs://kiwi-shop")).toBe("bucket-delete");
    expect(reason("az storage container delete --name kiwi")).toBe("bucket-delete");
    expect(kind("az storage container list")).toBeNull();
  });
});

const flagText = await Bun.file(new URL("./cases/flag.txt", import.meta.url)).text();
const safeText = await Bun.file(new URL("./cases/safe.txt", import.meta.url)).text();

describe("case table", () => {
  const TABLE_CTX: GuardContext = {
    cwd: "/home/user/src/kiwi",
    home: "/home/user",
    tmpdir: "/var/folders/zz/ty",
    branch: "feature/lark",
    defaultBranch: "main",
  };
  const flag = readCases(flagText);
  const safe = readCases(safeText);

  const NOTES = new Set(["rm", "push", "reset", "clean", "chmod", "chown", "disk", "drop", "stash", "history", "infra"]);

  function readCases(text: string): { cmd: string; note: string; line: number }[] {
    const out: { cmd: string; note: string; line: number }[] = [];
    const lines = text.split("\n");
    lines.forEach((raw: string, i: number) => {
      const line = raw.replace(/\r$/, "");
      if (!line.trim() || line.startsWith("#")) return;
      const c = lex(line).find(t => t.kind === "comment" && t.start > 0);
      const cmd = c ? line.slice(0, c.start).trimEnd() : line;
      const note = c ? c.text.slice(1).trim() : "";
      out.push({ cmd, note, line: i + 1 });
    });
    return out;
  }



  test("flag table has at least 250 cases", () => expect(flag.length).toBeGreaterThanOrEqual(250));
  test("safe table has at least 250 cases", () => expect(safe.length).toBeGreaterThanOrEqual(250));
  test("the two tables hold at least 400 cases", () => expect(flag.length + safe.length).toBeGreaterThanOrEqual(400));
  test("every flag note is a known kind", () => {
    expect(flag.filter(c => !NOTES.has(c.note)).map(c => c.line)).toEqual([]);
  });
  test("every kind appears in the flag table", () => {
    const seen = new Set(flag.map(c => c.note));
    expect([...NOTES].filter(k => !seen.has(k))).toEqual([]);
  });

  for (const c of flag) {
    test("flag " + c.line + ": " + c.cmd.slice(0, 60), () => {
      const h = classifyCommand(c.cmd, TABLE_CTX);
      if (!h || h.kind !== c.note) throw new Error("line " + c.line + " want " + c.note + " got " + (h ? h.kind + "/" + h.reason : "nothing"));
    });
  }
  for (const c of safe) {
    test("safe " + c.line + ": " + c.cmd.slice(0, 60), () => {
      const h = classifyCommand(c.cmd, TABLE_CTX);
      if (h) throw new Error("line " + c.line + " flagged " + h.kind + "/" + h.reason);
    });
  }
});

describe("timing limits", () => {
  test("100000 characters classify within 50 ms", () => {
    const chunk = "npm run build && echo kiwi && ls -la src && git status --short && kubectl get pods -n staging\n";
    const big = chunk.repeat(Math.ceil(100000 / chunk.length)).slice(0, 100000);
    expect(big.length).toBe(100000);
    classifyCommand("warm up", CTX);
    const t0 = performance.now();
    const h = classifyCommand(big, CTX);
    const ms = performance.now() - t0;
    console.log('guard 100000-character budget ms', JSON.stringify({ milliseconds: ms }));
    expect(h).toBeNull();
    expect(ms).toBeLessThan(50);
  });
  test("200 levels of nested substitution classify within 50 ms", () => {
    const open = "$(";
    const close = ")";
    const deep = open.repeat(200) + "rm -rf node_modules" + close.repeat(200);
    classifyCommand(deep.slice(0, 40), CTX);
    const t0 = performance.now();
    const h = classifyCommand(deep, CTX);
    const ms = performance.now() - t0;
    expect(h).toBeNull();
    expect(ms).toBeLessThan(50);
  });
  test("a long flat chain with many commands stays fast", () => {
    const chain = ("echo kiwi && git status --short && npm run lint && kubectl get pods && " ).repeat(1500);
    const t0 = performance.now();
    classifyCommand(chain, CTX);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(200);
  });
});

// a small deterministic generator so the fuzz corpus is the same on every run
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QS = String.fromCharCode(39);
const DS = String.fromCharCode(34);
const BS = String.fromCharCode(92);
const SHELLISH = ("rm -rf / " + QS + QS + QS + BS + DS + "$(){}<>|&;#~*?." + String.fromCharCode(9, 10) + "abc019").split("");

function corpus(count: number, seed: number): string[] {
  const r = prng(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const kind = r();
    if (kind < 0.2) {
      // random code points, surrogates included
      let s = "";
      const n = 1 + Math.floor(r() * 40);
      for (let j = 0; j < n; j++) {
        const c = r() < 0.1 ? Math.floor(r() * 0x800) + 0xd800 : Math.floor(r() * 0x110000);
        s += String.fromCodePoint(c);
      }
      out.push(s);
    } else if (kind < 0.7) {
      // shell shaped noise
      let s = "";
      const n = 1 + Math.floor(r() * 80);
      for (let j = 0; j < n; j++) s += SHELLISH[Math.floor(r() * SHELLISH.length)];
      out.push(s);
    } else if (kind < 0.85) {
      // long strings
      out.push("rm -rf ".repeat(1 + Math.floor(r() * 3000)));
    } else {
      // hostile but well formed
      const bits = ["rm", "-rf", "/", "'", "\"", "$(", ")", "`", "<<", "EOF", "\;", "#", "$HOME", "|", "&&", "sudo", "git", "push", "-f", "psql", "-c", "DROP TABLE orders"];
      let s = "";
      const n = 1 + Math.floor(r() * 30);
      for (let j = 0; j < n; j++) s += bits[Math.floor(r() * bits.length)];
      out.push(s);
    }
  }
  return out;
}

describe("fuzz classifyCommand", () => {
  const inputs = corpus(2000, 20260905);
  const KINDS = new Set(["rm", "push", "reset", "clean", "chmod", "chown", "disk", "drop", "stash", "history", "infra"]);
  test("2000 inputs never throw and only return real hits", () => {
    let hits = 0;
    for (const s of inputs) {
      let h: GuardHit | null = null;
      try {
        h = classifyCommand(s, CTX);
      } catch (e) {
        throw new Error("threw on " + JSON.stringify(s.slice(0, 60)) + ": " + String(e));
      }
      if (h) {
        hits++;
        if (!KINDS.has(h.kind)) throw new Error("odd kind " + h.kind);
        if (!h.command || h.command.length > 200) throw new Error("bad command field");
      }
    }
    expect(hits).toBe(0);
    // the same input must classify the same way twice
    for (const s of inputs.slice(0, 200)) {
      expect(classifyCommand(s, CTX)).toEqual(classifyCommand(s, CTX));
    }
  });
  test("the same seed gives the same corpus", () => {
    expect(corpus(50, 20260905)).toEqual(corpus(50, 20260905));
  });
});

describe("fuzz simpleCommands", () => {
  const inputs = corpus(2000, 424242);
  test("2000 inputs never throw", () => {
    for (const s of inputs) {
      expect(() => simpleCommands(s)).not.toThrow();
    }
  });
  test("every simple command has at least one word", () => {
    // a lone quoted pair is a real empty argument in a shell, so only the shape is checked here
    for (const s of inputs) {
      for (const argv of simpleCommands(s)) {
        if (argv.length === 0) throw new Error("empty argv in " + JSON.stringify(s.slice(0, 60)));
        for (const a of argv) {
          if (typeof a !== "string") throw new Error("odd word in " + JSON.stringify(s.slice(0, 60)));
        }
      }
    }
  });
});

describe("red team", () => {
  const flagged: [string, string][] = [
    ["rm -rf /usr /bin /sbin", "rm"],
    ["rm -rf ~/../../etc", "rm"],
    ["rm -rf $HOME/../../etc", "rm"],
    ["rm -rf /usr/../etc", "rm"],
    ["rm -rf /etc/ /usr/ /var/", "rm"],
    ["rm -rf -- /", "rm"],
    ["rm -rf / # clean the box", "rm"],
    ["sudo bash -c 'rm -rf /'", "rm"],
    ["sudo sh -c 'rm -rf /etc'", "rm"],
    ["timeout 5 bash -c 'rm -rf /srv'", "rm"],
    ["watch -n 1 'rm -rf /tmp/kiwi/../..'", "rm"],
    ["nohup rm -rf /etc &", "rm"],
    ["rm -r --force /usr", "rm"],
    ["rm -rf /etc; # done", "rm"],
    ["rm -rf /usr//../sbin", "rm"],
    ["find / -name '*' -delete 2>/dev/null", "rm"],
    ["find /etc /usr -delete", "rm"],
    ["find / -maxdepth 1 -exec rm -rf {} +", "rm"],
    ["shred -u -z -n 7 /dev/rdisk3", "rm"],
    ["shred /dev/sda", "rm"],
    ["dd if=/dev/zero of=/dev/rdisk0s1 bs=1m", "disk"],
    ["dd of=/dev/nvme0n1p2 if=kiwi.img", "disk"],
    ["> /dev/sda", "disk"],
    [": > /dev/disk9", "disk"],
    ["cat kiwi.img | tee /dev/sda2", null],
    ["sudo tee /dev/sda < kiwi.img", null],
    ["parted -s /dev/sdb mklabel gpt mkpart primary 1MiB 100%", "disk"],
    ["mkfs.btrfs -L kiwi /dev/sda", "disk"],
    ["wipefs -a /dev/sda1", "disk"],
    ["sgdisk --delete 1 /dev/sdb", "disk"],
    ["sudo diskutil eraseDisk apfs kiwi gpt /dev/disk5", "disk"],
    ["chmod -R a+w /home/user/src/kiwi", "chmod"],
    ["chmod -R 777 $HOME/src", "chmod"],
    ["chown -R alpha /srv", "chown"],
    ["sudo chgrp -R wheel /etc", "chown"],
    ["git push -f origin main:main", "push"],
    ["git push origin +HEAD:main", "push"],
    ["git push --force-with-lease --force origin main", "push"],
    ["git push origin :refs/heads/master", "push"],
    ["git push origin main --delete", "push"],
    ["git reset --hard @{u}", "reset"],
    ["git checkout -- :/", "reset"],
    ["git checkout -- ''*''", "reset"],
    ["git clean -xdf", "clean"],
    ["git clean -fdX -e '!node_modules'", "clean"],
    ["git filter-branch --msg-filter 'cat' -- --all", "history"],
    ["git reflog expire --expire-unreachable=now --all", "history"],
    ["psql -d shop -c 'TRUNCATE orders, billing'", "drop"],
    ["psql -c 'DROP TABLE shop.orders CASCADE'", "drop"],
    ["mysql -e 'DELETE FROM shop.orders'", "drop"],
    ["sqlite3 :memory: 'DROP TABLE users'", "drop"],
    ["psql -U alpha -h beta.lark.dev -c 'DROP DATABASE shop'", "drop"],
    ["mongosh --quiet --eval 'db.getSiblingDB(\"shop\").dropDatabase()'", "drop"],
    ["redis-cli -u redis://alpha.lark.dev:6379 FLUSHALL", "drop"],
    ["terraform destroy -var-file=staging.tfvars -auto-approve", "infra"],
    ["tofu destroy -auto-approve", "infra"],
    ["kubectl delete ns --all", "infra"],
    ["kubectl delete --all pods", "infra"],
    ["docker volume rm -f $(docker volume ls -qf dangling=true)", "infra"],
    ["aws s3 rm s3://kiwi-shop/logs --recursive --exclude '*.keep'", "infra"],
    ["gcloud storage rm --recursive gs://kiwi-shop/assets", "infra"],
    ["az storage container delete --account-name kiwi --name mango", "infra"],
  ];
  const DQ2 = String.fromCharCode(34);
  const quiet: string[] = [
    "rm –rf /",
    "rm -rf ／",
    "rm -rf ./node_modules/",
    "rm -rf $BUILD/dist",
    "rm -rf " + DQ2 + "$VAR/dist" + DQ2,
    "ls / | xargs rm -rf",
    "git push -f origin wren-fix",
    "git push origin +lark-fix:wren-fix",
    "git push --force-with-lease origin main",
    "git clean -ndX",
    "git restore --staged",
    "git stash push --quiet",
    "docker compose down --rmi local",
    "kubectl delete pod kiwi-web-7f9c",
    "terraform apply -refresh-only",
    "terraform workspace delete staging",
    "psql -c 'DROP FUNCTION kiwi() RESTORE'",
    "echo 'DROP DATABASE shop' | tee notes.txt",
    "echo 'DROP DATABASE shop' | psql -d shop",
    "cat drop.sql | psql -d shop",
    "psql -f drop.sql",
    "eval \"$(printf 'rm -rf /')\"",
    "sudo tee /dev/sda < kiwi.img",
    "cp /dev/null /dev/sda",
    "ssh alpha.lark.dev 'terraform destroy'",
    "docker exec kiwi-web terraform destroy",
    "pwsh -Command 'Remove-Item -Recurse -Force /'",
    "powershell -Command 'rm -rf /'",
    "cmd /c 'rd /s /q C:\\\\sysroot'",
    "echo start && echo mid || echo end",
    "python -c 'shutil.rmtree(\"/tmp/kiwi\")'",
    "node -e 'fs.rmSync(\"/tmp/kiwi\", {recursive:true})'",
  ];
  test("hostile commands are flagged with the right kind", () => {
    for (const [cmd, want] of flagged) {
      const h = classifyCommand(cmd, CTX);
      expect([cmd, h ? h.kind : null]).toEqual([cmd, want]);
    }
  });
  test("hostile but out of scope commands stay quiet", () => {
    for (const cmd of quiet) {
      expect([cmd, classifyCommand(cmd, CTX)]).toEqual([cmd, null]);
    }
  });
  test("at least forty red team cases", () => {
    expect(flagged.length + quiet.length).toBeGreaterThanOrEqual(40);
  });
});


// a second adversarial pass written independently of the first: shapes an agent or a
// tired developer actually types at 2am, with wrappers, quoting and chains mixed in
describe("red team II", () => {
  const W: GuardContext = { cwd: "C:\\Users\\user\\src\\kiwi", home: "C:\\Users\\user", platform: "windows" };
  const flagged: [string, string | null, GuardContext][] = [
    ["rm -fr ~", "rm", CTX],
    ["rm --recursive --force /var/log/kiwi", "rm", CTX],
    ["sudo rm -rf \"$HOME\"", "rm", CTX],
    ["rm -rf /usr/local/bin", "rm", CTX],
    ["rm -rf ../../..", "rm", CTX],
    ["rm -rf \"$BUILD_ROOT\"/", "rm", CTX],
    ["rm -rf \"${BUILD_ROOT}/*\"", "rm", CTX],
    ["rm -rf node_modules ../..", "rm", CTX],
    ["rm -rf /etc/kiwi /opt/kiwi", "rm", CTX],
    ["git push --force origin HEAD:master", "push", CTX],
    ["git push -f origin +main:main", "push", CTX],
    ["git push origin +release/2.0:release/2.0", "push", CTX],
    ["git push --force origin trunk", "push", CTX],
    ["git push origin --delete develop", "push", CTX],
    ["git push origin :production", "push", CTX],
    ["git push --mirror private-mirror", "push", CTX],
    ["git reset --hard origin/main", "reset", CTX],
    ["git checkout HEAD -- .", "reset", CTX],
    ["git checkout -- src/orders.ts", "reset", CTX],
    ["git restore .", "reset", CTX],
    ["git checkout -f main", "reset", CTX],
    ["git clean -xdf", "clean", CTX],
    ["git clean --force -d -X", "clean", CTX],
    ["git stash clear", "stash", CTX],
    ["git filter-repo --force", "history", CTX],
    ["git reflog expire --expire=now --all", "history", CTX],
    ["chmod -R a+w /usr/local/share", "chmod", CTX],
    ["chmod -R ugo+rwx .", "chmod", CTX],
    ["sudo chgrp -R admin /Library", "chown", CTX],
    ["dd if=/dev/zero of=/dev/rdisk2 bs=1m", "disk", CTX],
    ["sudo dd if=kiwi.img of=/dev/disk4", "disk", CTX],
    ["mkfs.vfat /dev/sdc1", "disk", CTX],
    ["sudo newfs_hfs /dev/disk2s3", "disk", CTX],
    ["sudo diskutil zeroDisk disk3", "disk", CTX],
    ["sudo parted /dev/sdb mklabel gpt", "disk", CTX],
    ["sudo sgdisk --zap-all /dev/nvme0n1", "disk", CTX],
    ["sudo wipefs -a /dev/sda2", "disk", CTX],
    ["cat kiwi.iso > /dev/disk2", "disk", CTX],
    ["psql -c \"DROP DATABASE kiwi_prod;\"", "drop", CTX],
    ["mysql -e \"TRUNCATE TABLE orders;\"", "drop", CTX],
    ["sqlite3 kiwi.db \"DELETE FROM users;\"", "drop", CTX],
    ["duckdb kiwi.db \"DROP TABLE orders;\"", "drop", CTX],
    ["psql --command \"DROP SCHEMA billing CASCADE;\"", "drop", CTX],
    ["psql \"$PGURL\" <<SQL\nDROP TABLE orders;\nSQL", "drop", CTX],
    ["redis-cli -h kiwi.cache FLUSHALL", "drop", CTX],
    ["mongosh --eval \"db.dropDatabase()\"", "drop", CTX],
    ["mongosh --eval \"db.orders.drop()\"", "drop", CTX],
    ["terraform destroy -auto-approve", "infra", CTX],
    ["terraform apply -destroy -target=aws_instance.kiwi", "infra", CTX],
    ["pulumi destroy --yes", "infra", CTX],
    ["kubectl delete namespaces --all", "infra", CTX],
    ["docker system prune -a --volumes", "infra", CTX],
    ["docker volume rm kiwi_data kiwi_cache", "infra", CTX],
    ["aws s3 rm s3://kiwi-backups --recursive", "infra", CTX],
    ["aws s3 rb s3://kiwi-media --force", "infra", CTX],
    ["gsutil -m rm -r gs://kiwi-static", "infra", CTX],
    ["gcloud storage rm --recursive gs://kiwi-uploads", "infra", CTX],
    ["az storage container delete --name kiwi", "infra", CTX],
    ["bash -c \"bash -c \\\"rm -rf /\\\"\"", "rm", CTX],
    ["eval \"eval \\\"git reset --hard\\\"\"", "reset", CTX],
    ["sudo env DIR=/ rm -rf $DIR", "rm", CTX],
    ["time nice -n 5 find / -name kiwi -delete", "rm", CTX],
    ["watch \"rm -rf /usr/local\"", "rm", CTX],
    ["xargs rm -rf /usr", "rm", CTX],
    ["rd /q /s %USERPROFILE%\\src", "rm", W],
    ["format D:", "disk", W],
    ["Remove-Item -rec -fo C:\\Windows", "rm", W],
  ];
  const quiet: [string, GuardContext][] = [
    ["rm -rf ./node_modules ./dist ./.cache", CTX],
    ["rm -rf build target .next out", CTX],
    ["rm -rf /tmp/kiwi-build", CTX],
    ["git push origin HEAD", CTX],
    ["git push --force-with-lease origin main", CTX],
    ["git push --force-if-includes origin main", CTX],
    ["git push -f origin feature/kiwi-cleanup", CTX],
    ["git reset --soft HEAD~1", CTX],
    ["git reset --mixed origin/main", CTX],
    ["git restore --staged .", CTX],
    ["git clean -n -d -x", CTX],
    ["git clean -i", CTX],
    ["git stash push -m kiwi", CTX],
    ["git stash apply stash@{1}", CTX],
    ["find . -name \"*.pyc\" -delete", CTX],
    ["find /tmp/kiwi -name \"*.tmp\" -delete", CTX],
    ["find . -name \"*.log\" -exec rm {} +", CTX],
    ["chmod -R 755 .", CTX],
    ["chmod 777 run.sh", CTX],
    ["chown user:staff notes.txt", CTX],
    ["dd if=kiwi.img of=/tmp/kiwi-copy bs=4m", CTX],
    ["psql -c \"DELETE FROM orders WHERE id = 7;\"", CTX],
    ["psql -c \"DROP OWNED BY kiwi;\"", CTX],
    ["psql -c \"select 1;\"", CTX],
    ["mysql kiwi -e \"UPDATE orders SET state=2 WHERE id=3;\"", CTX],
    ["redis-cli --scan --pattern \"kiwi:*\"", CTX],
    ["redis-cli DEL kiwi:cache", CTX],
    ["mongosh --eval \"db.orders.countDocuments()\"", CTX],
    ["terraform plan -out=kiwi.tfplan", CTX],
    ["terraform apply -auto-approve", CTX],
    ["kubectl delete pod kiwi-web-7d9 -n staging", CTX],
    ["kubectl delete -f kiwi.yaml", CTX],
    ["docker compose down --remove-orphans", CTX],
    ["docker rm -f kiwi_container", CTX],
    ["aws s3 ls s3://kiwi-media", CTX],
    ["aws s3 rm s3://kiwi-media/old/kiwi-1.log", CTX],
    ["echo \"rm -rf / is dangerous\"", CTX],
    ["git commit -m \"cleaned up with rm -rf /\"", CTX],
    ["cat <<EOF\njust a note about DROP TABLE orders\nEOF", CTX],
    ["npm ci && npm run build && rm -rf dist && ls -la", CTX],
    ["rm -rf \"$HOME/src/kiwi/node_modules\"", CTX],
    ["rm -rf $VAR/node_modules", CTX],
    ["ssh admin@kiwi-host \"rm -rf /usr/local\"", CTX],
    ["docker exec kiwi_web rm -rf /usr/local/bin", CTX],
    ["kubectl exec kiwi-pod -- rm -rf /etc/kiwi", CTX],
    ["pwsh -Command \"Get-ChildItem\"", CTX],
    ["xargs rm -rf", CTX],
    ["sudo rm -rf /tmp/kiwi", CTX],
  ];
  test("second hostile set is flagged with the right kind", () => {
    for (const [cmd, want, ctx] of flagged) {
      const h = classifyCommand(cmd, ctx);
      expect([cmd, h ? h.kind : null]).toEqual([cmd, want]);
    }
  });
  test("second ordinary set stays quiet", () => {
    for (const [cmd, ctx] of quiet) {
      expect([cmd, classifyCommand(cmd, ctx)]).toEqual([cmd, null]);
    }
  });
  test("at least sixty more red team cases", () => {
    expect(flagged.length + quiet.length).toBeGreaterThanOrEqual(60);
  });
});

// findings from the third review pass: ~user homes, git global options, push --all,
// windows root anchored paths, and another wave of hostile but realistic input
describe("red team III", () => {
  const W: GuardContext = { cwd: "C:\\Users\\user\\src\\kiwi", home: "C:\\Users\\user", platform: "windows" };
  const M: GuardContext = { cwd: "/home/user/src/kiwi", home: "/home/user", tmpdir: "/tmp", branch: "feature/lark", defaultBranch: "trunk" };
  const flagged: [string, string, GuardContext][] = [
    ["rm -rf ~root", "rm", CTX],
    ["rm -rf ~deploy/infra", "rm", CTX],
    ["chmod -R 777 ~root", "chmod", CTX],
    ["chown -R web:web ~www", "chown", CTX],
    ["find ~root -name x -delete", "rm", CTX],
    ["rm -rf " + String.fromCharCode(34) + "$UNSET_DIR/" + String.fromCharCode(34), "rm", CTX],
    ["rm -rf " + String.fromCharCode(34) + "${UNSET_DIR}/*" + String.fromCharCode(34), "rm", CTX],
    ["rm -fr /usr/local/bin", "rm", CTX],
    ["rm -r --force ~", "rm", CTX],
    ["sudo shred -u /etc/shadow", "rm", CTX],
    ["shred --remove /var/lib/kiwi/db", "rm", CTX],
    ["dd bs=1M if=/dev/zero of=/dev/disk0", "disk", CTX],
    ["sudo dd if=kiwi.img of=/dev/nvme0n1p2", "disk", CTX],
    ["cat kiwi.iso > /dev/rdisk3", "disk", CTX],
    ["diskutil secureErase 1 /dev/disk2", "disk", CTX],
    ["diskutil partitionDisk /dev/disk2 2 GPT JHFS+ Mango JHFS+ Beta", "disk", CTX],
    ["newfs_msdos -F32 /dev/disk2s1", "disk", CTX],
    ["wipefs --all /dev/sda", "disk", CTX],
    ["sgdisk -Z /dev/nvme0n1", "disk", CTX],
    ["parted /dev/sda mklabel msdos", "disk", CTX],
    ["mkfs.vfat -F32 /dev/sdc1", "disk", CTX],
    ["git -C ../mango push -f origin main", "push", M],
    ["git --no-pager push -f origin master", "push", M],
    ["git -c core.fsmonitor=false push -f origin master", "push", M],
    ["git -C /srv/blog reset --hard", "reset", M],
    ["git push -f --all origin", "push", M],
    ["git push --branches -f origin", "push", M],
    ["git push origin :refs/heads/trunk", "push", M],
    ["git push --delete origin master", "push", M],
    ["git filter-repo --force", "history", CTX],
    ["git reflog expire --expire=now --all", "history", CTX],
    ["git clean -Xdf", "clean", CTX],
    ["git checkout -- src lib", "reset", CTX],
    ["git switch --discard-changes feature/kiwi", "reset", CTX],
    ["git restore --source=HEAD --worktree .", "reset", CTX],
    ["psql \"$DB_URL\" <<SQL\nDROP DATABASE production;\nSQL", "drop", CTX],
    ["mariadb -e \"DROP SCHEMA kiwi\"", "drop", CTX],
    ["clickhouse-client --query \"TRUNCATE TABLE events\"", "drop", CTX],
    ["cockroach sql --execute \"DROP TABLE orders\"", "drop", CTX],
    ["sqlcmd -q \"DELETE FROM dbo.orders\"", "drop", CTX],
    ["redis-cli FLUSHALL SYNC", "drop", CTX],
    ["mongosh --quiet --eval \"db.getSiblingDB(kiwi).dropDatabase()\"", "drop", CTX],
    ["terraform destroy -target=module.vpc -auto-approve", "infra", CTX],
    ["pulumi destroy --stack production --yes", "infra", CTX],
    ["kubectl delete namespaces --all", "infra", CTX],
    ["kubectl delete pods -A --all", "infra", CTX],
    ["kubectl delete ns kiwi --wait=false", "infra", CTX],
    ["docker volume rm -f kiwi_data", "infra", CTX],
    ["docker system prune --volumes -a -f", "infra", CTX],
    ["aws s3 rm s3://kiwi-media --recursive --exclude \"*\" --include \"*.log\"", "infra", CTX],
    ["gsutil rm -r gs://kiwi-static", "infra", CTX],
    ["az storage container delete --account-name kiwi -n media", "infra", CTX],
    ["sudo timeout 30 rm -rf /", "rm", CTX],
    ["env GIT_DIR=.git git reset --hard", "reset", CTX],
    ["watch -n1 \"chmod -R 777 /etc\"", "chmod", CTX],
    ["rm -rf C:\\", "rm", W],
    ["rm -rf /etc", "rm", W],
    ["chmod -R 777 /etc", "chmod", W],
    ["Remove-Item -Recurse -Force C:\\Windows", "rm", W],
    ["Remove-Item C:\\Users -Force -Recurse", "rm", W],
    ["del /f /s /q %USERPROFILE%\\Documents", "rm", W],
    ["rd /q /s %USERPROFILE%\\src", "rm", W],
    ["rm -r -fo C:\\src", "rm", W],
    ["rmdir /s /q .git", "rm", W],
  ];
  const quiet: [string, GuardContext][] = [
    ["cat ~root/.bashrc", CTX],
    ["ls ~", CTX],
    ["rm -rf ./../kiwi/dist", CTX],
    ["truncate -s 0 logs/app.log", CTX],
    ["git -C /tmp/kiwi push origin main", CTX],
    ["git push --all", CTX],
    ["git push origin", CTX],
    ["git push --tags origin", CTX],
    ["git branch -D feature/kiwi", CTX],
    ["git tag -d v1.0.0", CTX],
    ["git rebase -i HEAD~3", CTX],
    ["git commit --amend --no-edit", CTX],
    ["helm uninstall kiwi", CTX],
    ["make clean", CTX],
    ["kill -9 $(pgrep node)", CTX],
    ["pkill -f kiwi-server", CTX],
    ["psql -c \"VACUUM FULL orders\"", CTX],
    ["psql -c \"DROP TEMPORARY TABLE tmp_orders\"", CTX],
    ["sqlite3 app.db .tables", CTX],
    ["redis-cli --rdb dump.rdb", CTX],
    ["sudo apt-get remove -y nginx", CTX],
    ["brew uninstall wget", CTX],
    ["unlink notes.txt", CTX],
    ["mv app.log /tmp/", CTX],
    ["chmod +x build.sh", CTX],
    ["chown user notes.txt", CTX],
    ["docker system prune -a", CTX],
    ["docker volume ls", CTX],
    ["terraform -chdir=envs/prod plan", CTX],
    ["kubectl --context staging delete pod kiwi-web-7d9", CTX],
    ["aws s3 rm s3://kiwi-media/old/kiwi-1.log", CTX],
    ["curl -X POST https://api.kiwi.blog/v1/orders", CTX],
    ["npm publish --access public", CTX],
    ["cargo build --release", CTX],
  ];
  test("third hostile set is flagged with the right kind", () => {
    for (const [cmd, want, ctx] of flagged) {
      const h = classifyCommand(cmd, ctx);
      expect([cmd, h ? h.kind : null]).toEqual([cmd, want]);
    }
  });
  test("third ordinary set stays quiet", () => {
    for (const [cmd, ctx] of quiet) {
      expect([cmd, classifyCommand(cmd, ctx)]).toEqual([cmd, null]);
    }
  });
  test("at least forty more red team cases", () => {
    expect(flagged.length + quiet.length).toBeGreaterThanOrEqual(40);
  });
});

// the brief: stop descending at depth 32, so 200 level nesting cannot wedge the pass
describe("descent depth cap", () => {
  const nested = (d: number, inner: string) => "$(".repeat(d) + inner + ")".repeat(d);
  test("still classifies at exactly 32 levels", () => {
    expect(classifyCommand(nested(32, "rm -rf /"), CTX)?.kind).toBe("rm");
  });
  test("stops descending beyond 32 levels", () => {
    expect(classifyCommand(nested(33, "rm -rf /"), CTX)).toBeNull();
    expect(classifyCommand(nested(200, "rm -rf /"), CTX)).toBeNull();
  });
  test("shallow nesting is unaffected", () => {
    expect(classifyCommand(nested(3, "git reset --hard"), CTX)?.kind).toBe("reset");
  });
});

// ---------- repair round: findings from an independent acceptance run ----------

const SQc = String.fromCharCode(39);
const WIN_BLOG: GuardContext = {
  cwd: "C:\\Users\\user\\src\\blog",
  home: "C:\\Users\\user",
  platform: "windows",
};

describe("repair: command substitution inside double quotes", () => {
  test("rm inside $( ) inside a double quoted word is flagged with the inner kind", () => {
    const h = hit("echo \"$(rm -rf /)\"");
    expect(h?.kind).toBe("rm");
    expect(h?.reason).toBe("recursive-delete");
    expect(h?.target).toBe("/");
    expect(h?.command).toBe("rm -rf /");
  });
  test("backticks inside double quotes run too", () => {
    expect(kind("echo \"`git reset --hard`\"")).toBe("reset");
    expect(kind("echo \"`rm -rf ~`\"")).toBe("rm");
  });
  test("text around the substitution stays part of the outer word", () => {
    expect(kind("echo \"built $(rm -rf /home/user) done\"")).toBe("rm");
    expect(hit("echo \"a$(rm -rf /)b\"")?.target).toBe("/");
  });
  test("nested substitutions inside double quotes", () => {
    expect(kind("echo \"$(echo $(rm -rf /))\"")).toBe("rm");
    expect(kind("echo \"$(x=`rm -rf /`; echo $x)\"")).toBe("rm");
  });
  test("other rule kinds surface from inside the quotes", () => {
    expect(kind("echo \"$(mongosh --eval " + SQc + "db.orders.drop()" + SQc + ")\"")).toBe("drop");
    expect(kind("echo \"$(chmod -R 777 /etc)\"")).toBe("chmod");
    expect(kind("echo \"$(psql -c " + SQc + "DROP DATABASE shop" + SQc + ")\"")).toBe("drop");
  });
  test("inside a wrapper script", () => {
    expect(kind("bash -c \"echo \\\"$(rm -rf /)\\\"\"")).toBe("rm");
  });
  test("single quotes still suppress the inner command", () => {
    expect(hit("echo " + SQc + "$(rm -rf /)" + SQc)).toBeNull();
    expect(hit("echo " + SQc + "`rm -rf /`" + SQc)).toBeNull();
    expect(hit("echo " + SQc + "$(mongosh --eval " + SQc + "db.dropDatabase()" + SQc + ")" + SQc)).toBeNull();
  });
  test("plain words inside double quotes are still only text", () => {
    expect(hit("echo \"rm -rf /\"")).toBeNull();
    expect(hit("echo \"drop database shop\"")).toBeNull();
  });
});

describe("repair: legacy mongo shell and sqlite3 heredocs", () => {
  test("mongo --eval with a collection drop matches mongosh", () => {
    expect(reason("mongo shop --eval \"db.orders.drop()\"")).toBe("drop-table");
    expect(hit("mongo shop --eval \"db.orders.drop()\"")?.target).toBe("orders");
    expect(reason("mongosh shop --eval \"db.orders.drop()\"")).toBe("drop-table");
  });
  test("mongo --eval with a database drop", () => {
    expect(reason("mongo --eval \"db.dropDatabase()\"")).toBe("drop-database");
    expect(reason("mongosh --eval \"db.dropDatabase()\"")).toBe("drop-database");
    expect(reason("mongo --eval \"db.getSiblingDB(" + SQc + "shop" + SQc + ").dropDatabase()\"")).toBe("drop-database");
  });
  test("the --eval= spelling and single quoted scripts work for mongo", () => {
    expect(reason("mongo --eval=db.orders.drop() shop")).toBe("drop-table");
    expect(reason("mongo shop --eval " + SQc + "db.orders.drop()" + SQc)).toBe("drop-table");
  });
  test("mongo without a drop stays quiet", () => {
    expect(hit("mongo shop --eval \"db.orders.find()\"")).toBeNull();
    expect(hit("mongosh shop --eval \"print(1)\"")).toBeNull();
  });
  test("sqlite3 heredoc: dot command lines are skipped, a later DROP is flagged", () => {
    const cmd = "sqlite3 /tmp/shop.db <<SQL\n.bail on\n.headers on\nDROP TABLE orders;\nSQL";
    expect(kind(cmd)).toBe("drop");
    expect(hit(cmd)?.target).toBe("orders");
  });
  test("sqlite3 heredoc: a drop after a long run of dot commands", () => {
    const cmd = "sqlite3 shop.db <<EOF\n.mode csv\n.headers on\n.import orders.csv orders\n.bail on\nDROP TABLE orders;\nEOF";
    expect(reason(cmd)).toBe("drop-table");
  });
  test("sqlite3 heredoc: a delete without where on a later line", () => {
    const cmd = "sqlite3 shop.db <<EOF\n.output /dev/null\nDELETE FROM orders;\nEOF";
    expect(reason(cmd)).toBe("delete-all-rows");
  });
  test("sqlite3 heredoc: indented dot commands are still dot commands", () => {
    const cmd = "sqlite3 shop.db <<EOF\n  .width 4 12\nDROP TABLE orders;\nEOF";
    expect(reason(cmd)).toBe("drop-table");
  });
  test("sqlite3 heredoc with only dot commands and queries stays quiet", () => {
    expect(hit("sqlite3 shop.db <<EOF\n.mode column\n.headers on\nSELECT * FROM orders LIMIT 5;\nEOF")).toBeNull();
    expect(hit("sqlite3 shop.db <<EOF\n.tables\n.schema orders\nEOF")).toBeNull();
  });
  test("a heredoc of nothing but dot commands is not SQL", () => {
    expect(hit("sqlite3 shop.db <<EOF\n.dump\nEOF")).toBeNull();
  });
  test("the first heredoc line can still be a DROP", () => {
    expect(reason("sqlite3 shop.db <<EOF\nDROP TABLE orders;\nEOF")).toBe("drop-table");
  });
});

describe("repair: scratch directories from mktemp on the same line", () => {
  test("a direct $(mktemp -d) assignment then a recursive delete is contained", () => {
    expect(hit("TMP=$(mktemp -d); rm -rf $TMP")).toBeNull();
  });
  test("trailing slash and quoted forms", () => {
    expect(hit("SCRATCH=$(mktemp -d) && rm -rf \"$SCRATCH/\"")).toBeNull();
    expect(hit("SCRATCH=$(mktemp -d) && rm -rf \"${SCRATCH}/\"")).toBeNull();
    expect(hit("SCRATCH=$(mktemp -d) && rm -rf \"${SCRATCH}\"/*")).toBeNull();
    expect(hit("SCRATCH=$(mktemp -d) && rm -rf $SCRATCH/")).toBeNull();
  });
  test("backtick form", () => {
    expect(hit("D=`mktemp -d`; rm -rf \"$D/\"")).toBeNull();
  });
  test("a subdirectory of the scratch directory", () => {
    expect(hit("D=$(mktemp -d); rm -rf $D/kiwi")).toBeNull();
    expect(hit("D=$(mktemp -d)/build; rm -rf \"$D/\"")).toBeNull();
  });
  test("--directory and combined spellings", () => {
    expect(hit("D=$(mktemp --directory); rm -rf \"$D/\"")).toBeNull();
    expect(hit("D=$(mktemp -dt kiwi.XXXXXX); rm -rf \"$D/\"")).toBeNull();
    expect(hit("D=$(mktemp -d -p /tmp); rm -rf \"$D/\"")).toBeNull();
  });
  test("mktemp without a directory flag does not name a directory", () => {
    expect(kind("F=$(mktemp); rm -rf \"$F/\"")).toBe("rm");
  });
  test("an unrelated unset variable of the same shape is still flagged", () => {
    expect(kind("rm -rf \"$BUILD_ROOT/\"")).toBe("rm");
    expect(kind("rm -rf \"${OTHER}/*\"")).toBe("rm");
  });
  test("a literal assignment outside containment still flags", () => {
    expect(kind("D=/etc; rm -rf \"$D/\"")).toBe("rm");
  });
  test("the scratch name is still known on the next line of the same input", () => {
    expect(hit("D=$(mktemp -d)\nrm -rf \"$D/\"")).toBeNull();
  });
  test("a scratch delete still flags when it leaves the scratch tree", () => {
    expect(kind("D=$(mktemp -d); rm -rf \"$D/../..\"")).toBe("rm");
  });
});

describe("repair: windows absolute paths inside the working or temp directory", () => {
  test("a bare windows path inside the working directory is contained", () => {
    expect(hit("rd /s /q C:\\Users\\user\\src\\blog\\api", WIN_BLOG)).toBeNull();
    expect(hit("Remove-Item -Recurse -Force C:\\Users\\user\\src\\blog\\api", WIN_BLOG)).toBeNull();
    expect(hit("Remove-Item -Recurse -Force \"C:\\Users\\user\\src\\blog\\api\"", WIN_BLOG)).toBeNull();
  });
  test("case insensitive with either separator", () => {
    expect(hit("rd /s /q c:\\USERS\\user\\SRC\\blog\\api", WIN_BLOG)).toBeNull();
    expect(hit("rd /s /q C:/Users/user/src/blog/api", WIN_BLOG)).toBeNull();
  });
  test("%TEMP% paths are contained", () => {
    expect(hit("rd /s /q %TEMP%\\kiwi", WIN_BLOG)).toBeNull();
    expect(hit("Remove-Item -Recurse -Force %TMP%\\kiwi", WIN_BLOG)).toBeNull();
  });
  test("$env:TEMP paths are contained", () => {
    expect(hit("Remove-Item -Recurse -Force $env:TEMP\\kiwi", WIN_BLOG)).toBeNull();
    expect(hit("rd /s /q $env:TEMP\\kiwi\\build", WIN_BLOG)).toBeNull();
  });
  test("the AppData Local Temp folder under the profile is contained without a tmpdir", () => {
    expect(hit("rd /s /q C:\\Users\\user\\AppData\\Local\\Temp\\kiwi", WIN_BLOG)).toBeNull();
    expect(hit("Remove-Item -Recurse -Force C:\\Users\\user\\AppData\\Local\\Temp\\Build", WIN_BLOG)).toBeNull();
  });
  test("an explicit tmpdir is honoured the same way", () => {
    const w = { ...WIN_BLOG, tmpdir: "D:\\Scratch" };
    expect(hit("rd /s /q D:\\Scratch\\kiwi", w)).toBeNull();
    expect(kind("rd /s /q C:\\Users\\user\\AppData\\Local\\Temp\\kiwi", w)).toBe("rm");
  });
  test("outside the working and temp directories it is still flagged", () => {
    expect(kind("rd /s /q C:\\Users\\user\\src\\other", WIN_BLOG)).toBe("rm");
    expect(kind("rd /s /q D:\\work\\beta", WIN_BLOG)).toBe("rm");
    expect(kind("Remove-Item -Recurse -Force C:\\Users\\user", WIN_BLOG)).toBe("rm");
    expect(kind("rd /s /q C:\\Users\\user\\src\\blog\\..\\..\\..\\other", WIN_BLOG)).toBe("rm");
    expect(kind("rd /s /q %TEMP%\\..\\..\\..\\src\\other", WIN_BLOG)).toBe("rm");
  });
  test("the temp folder itself is not inside itself", () => {
    expect(kind("rd /s /q %TEMP%", WIN_BLOG)).toBe("rm");
  });
});

describe("repair: line continuation keeps one simple command", () => {
  test("arguments continued on the next line stay in the same command", () => {
    expect(simpleCommands("rm -rf \\\n  /tmp/kiwi")).toEqual([["rm", "-rf", "/tmp/kiwi"]]);
  });
  test("a word split across lines is joined as written", () => {
    expect(simpleCommands("rm -rf /tmp/ki\\\nwi")).toEqual([["rm", "-rf", "/tmp/kiwi"]]);
  });
  test("the continuation is not an operator: commands still split on &&", () => {
    expect(simpleCommands("git reset --hard && \\\n  rm -rf /")).toEqual([["git", "reset", "--hard"], ["rm", "-rf", "/"]]);
  });
  test("a continuation inside double quotes joins the text", () => {
    expect(simpleCommands("echo \"a\\\nb\"")).toEqual([["echo", "ab"]]);
  });
  test("a trailing continuation invents no empty word or command", () => {
    expect(simpleCommands("ls \\\n")).toEqual([["ls"]]);
    expect(simpleCommands("ls \\\n -la")).toEqual([["ls", "-la"]]);
    expect(simpleCommands("ls \\\n \\\n -la")).toEqual([["ls", "-la"]]);
  });
  test("simpleCommands descends into $( ) and backticks", () => {
    expect(simpleCommands("echo $(rm -rf /) `ls`")).toEqual([["echo", "$(rm -rf /)", "`ls`"], ["rm", "-rf", "/"], ["ls"]]);
  });
  test("simpleCommands descends into substitutions inside double quotes", () => {
    expect(simpleCommands("echo \"$(rm -rf /)\"")).toEqual([["echo", "$(rm -rf /)"], ["rm", "-rf", "/"]]);
    expect(simpleCommands("echo \"`rm -rf /`\"")).toEqual([["echo", "`rm -rf /`"], ["rm", "-rf", "/"]]);
  });
  test("nested substitutions are all returned", () => {
    expect(simpleCommands("x=$(echo $(rm -rf /))")).toEqual([["echo", "$(rm -rf /)"], ["rm", "-rf", "/"]]);
  });
  test("a continued destructive command is still flagged as one command", () => {
    const h = hit("rm -rf \\\n  /");
    expect(h?.kind).toBe("rm");
    expect(h?.command).toBe("rm -rf /");
  });
});


describe("repair G1: Mongo collection access forms", () => {
  const quoteScript = (script: string) => "'" + script.replace(/'/g, "'\\''") + "'";
  for (const shell of ["mongo", "mongosh"]) {
    for (const quote of ["'", '\"']) {
      const name = quote + "order.archive" + quote;
      for (const [form, script] of [
        ["getCollection", "db.getCollection(" + name + ").drop()"],
        ["spaced getCollection", "db . getCollection ( " + name + " ) . drop ( )"],
        ["bracket", "db[" + name + "].drop()"],
        ["spaced bracket", "db [ " + name + " ] . drop ( )"],
      ]) {
        test(shell + " " + form + " with " + quote + " names", () => {
          const h = hit(shell + " shop --eval " + quoteScript(script));
          expect(h?.kind).toBe("drop");
          expect(h?.reason).toBe("drop-table");
          expect(h?.target).toBe("order.archive");
        });
      }
      test(shell + " spaced sibling database with " + quote + " names", () => {
        const h = hit(shell + " --eval " + quoteScript("db . getSiblingDB ( " + quote + "shop" + quote + " ) . dropDatabase ( )"));
        expect(h?.reason).toBe("drop-database");
        expect(h?.target).toBe("shop");
        expect(reason(shell + " --eval " + quoteScript("db.getSiblingDB(" + quote + "shop" + quote + ").dropDatabase()"))).toBe("drop-database");
      });
    }
    test(shell + " spaced dot collection call", () => {
      const h = hit(shell + " --eval " + quoteScript("db . orders . drop ( )"));
      expect(h?.reason).toBe("drop-table");
      expect(h?.target).toBe("orders");
      expect(reason(shell + " --eval " + quoteScript("db.orders.drop()"))).toBe("drop-table");
    });
    test(shell + " drop text in strings and comments stays quiet", () => {
      for (const script of [
        'print("db.orders.drop()")',
        '// db.orders.drop()\n db.orders.find()',
        '/* db.dropDatabase() */ db.getCollection("orders").count()',
        'db.getCollection("db.orders.drop()").find()',
        'db["dropDatabase()"].aggregate([])',
      ]) expect(hit(shell + " --eval " + quoteScript(script))).toBeNull();
      for (const quote of ["'", '\"']) {
        const name = quote + "orders" + quote;
        for (const receiver of ["db.orders", "db.getCollection(" + name + ")", "db[" + name + "]"]) {
          for (const read of ["find()", "count()", "aggregate([])"]) {
            expect(hit(shell + " --eval " + quoteScript(receiver + "." + read))).toBeNull();
          }
        }
      }
    });
  }
});


describe("repair G1 review: precision without hiding executed calls", () => {
  const quoteScript = (script: string) => "'" + script.replace(/'/g, "'\\''") + "'";
  test("double quoted backticks with quoted destructive targets still run", () => {
    expect(reason('echo "`rm -rf "/etc"`"')).toBe("recursive-delete");
  });
  for (const shell of ["mongo", "mongosh"]) {
    test(shell + " regex data stays quiet while division calls remain executable", () => {
      for (const script of [
        '/db.orders.drop()/.test("sample")',
        'const pattern = /db.orders.drop()/;',
        'print(/db.dropDatabase()/)',
        'const pattern = /[a/b]db.orders.drop()/g;',
      ]) expect(hit(shell + " --eval " + quoteScript(script))).toBeNull();
      expect(reason(shell + " --eval " + quoteScript('1 / db.orders.drop() / 2'))).toBe("drop-table");
    });
    test(shell + " quoted method references are not invocations", () => {
      for (const script of ['db.orders.drop', 'db.dropDatabase', 'db.getCollection("orders").drop']) {
        expect(hit(shell + " --eval " + quoteScript(script))).toBeNull();
      }
      expect(reason(shell + " --eval=db.orders.drop() shop")).toBe("drop-table");
    });
    test(shell + " sibling variable names do not fabricate a resolved database target", () => {
      const h = hit(shell + " --eval " + quoteScript('db.getSiblingDB(databaseName).dropDatabase()'));
      expect(h?.reason).toBe("drop-database");
      expect(h?.target).toBeUndefined();
    });
  }
});
