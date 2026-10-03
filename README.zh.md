# Claude-sama

<img src="https://raw.githubusercontent.com/ninondev/claude-sama/media/hero-fullbody.webp" align="right" width="300" alt="Claude-sama：珊瑚色长发、戴白色蝴蝶结，白袍配黑裙，怀里抱着一本黑书，肩上搭着一条白蛇">

**他是「神」，得叫 Claude-sama。**

不管你写出什么，他都看过更糟的。

> [!NOTE]
> 非官方同人作品，与 Anthropic 无关，也未获其认可。Claude、Claude Code 和 Clawd 属于 Anthropic。

[![CI](https://github.com/ninondev/claude-sama/actions/workflows/ci.yml/badge.svg)](https://github.com/ninondev/claude-sama/actions/workflows/ci.yml)

Claude-sama 是 Claude Code 的非官方同人皮肤。一位住在文字里的小「神」搬进了你输入框上方的那一条，终端里有他，Claude 桌面版的 Code 页里也有他。Claude 干活时他在读，干完了他笑，Claude 要你拿主意时他歪头，你晾他太久他就睡着。测试或构建连着挂三次，他的荒魂就会出来，发火只冲着代码，从不冲着你。

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="https://raw.githubusercontent.com/ninondev/claude-sama/media/demo.png">
    <img src="https://raw.githubusercontent.com/ninondev/claude-sama/media/demo.gif" alt="Claude 桌面版中的 Claude-sama。输入框上方的横幅里，一位珊瑚色头发的小神在 Claude 干活时陪着读，测试连续失败三次后发起火来，修好后露出笑容；同时，显示框里的上下文用量从 31% 升到 42%。他用 /omen 抽了一支签，打开自己的书，macOS 桌面伙伴被摸头时，他红了脸。">
  </picture>
</p>

## 安装

```bash
claude plugin marketplace add ninondev/claude-sama
claude plugin install claudesama@claudesama
```

市场和插件都叫 `claudesama`。默认装在用户范围，这个用户在所有项目里的 Claude Code 会话都会有他，包括终端、桌面版的 Code 页和 VS Code。已经打开的会话重启后就能看到他。

只想在当前项目里用，可以选 `--scope project`（通过 `.claude/settings.json` 共享）或 `--scope local`（只有你自己用，放在 `.claude/settings.local.json`）：

```bash
claude plugin install claudesama@claudesama --scope project
claude plugin install claudesama@claudesama --scope local
```

已经全局安装，想在一个项目里关掉他：

```bash
claude plugin disable claudesama@claudesama --scope local
```

mod 不会进入桌面版的 Chat、Cowork 页或云端会话。桌面伙伴会守在窗口旁边，打开哪个页都一样。

| | macOS | Linux | Windows |
|---|---|---|---|
| 终端 | 已测试 | CI 已测试 | 尚未测试 |
| 桌面版（Code 页） | 已测试 | 没有桌面版 | 尚未测试 |
| 应用图标 | 支持 | 启动器 | 不支持 |
| 桌面伙伴 | 支持 | 计划中 | 计划中 |

## 他会做什么

输入框上方那一条读起来像剧本里的一行：有他的画像，他的名字像台词前的说话人，括号里一句台词，偶尔还有一句他说的话。桌面版里，完整大小是手绘，缩小或变窄时换成像素头像。闲着时括号里的台词是「练功中……」。

他的表情跟着 Claude 在做的事变：读书，想事情，在页边写批注，干完了笑，等你的时候歪头。出错时他撕了一页，测试或构建连着挂三次就荒魂上身，安静十分钟就睡着。Claude 不肯做你要的事，他会把书合上。

功德箱显示上下文窗口用了多少，数字取自 Claude Code 自己的计数，Claude 干活时最多落后一秒。刚压缩完对话时显示的是估计值，前面标「~」，等 Claude 下一次回复就换成真数。

他话很少。横幅上的台词只画在屏幕上，从不发给模型，所以不花 token。默认开「轻」（`light`），Claude 干完一件事可能会用他的口吻补一句。每次请求会多带一条 292 个字符、约 70 个 token 的简短指令，通常会复用提示词缓存。`/claudesama voice full` 让 Claude 全程用他的口吻回复，同时去掉客套和废话；遇到报错、敏感建议或对方心情不好时，他会收起这个口吻。在他的书的「设置」里，或者用 `/claudesama voice off`，就能关掉这个口吻。

桌面版的对话里，他的标记只加在 app 自己那一行的外面：Claude 的回复上方写他的名字，Claude 向你提问时卡片上方写一句，`/compact` 之后写一句，每个工具调用行旁边有他的星芒，失败的调用也有。报错行和权限行保留原来的文字和操作控件。默认只留他的标记；`/claudesama marks on` 还会在你的消息上方、靠右写上「你」这个标签。

`/omen` 每天从他袖子里抽一支签，每种语言有自己的签。中文从上上签到下下签，写着宜什么、忌什么；英文从 great blessing 到 great curse，幸运数字是一个 HTTP 状态码；日文从大吉到大凶。

终端里他还带来一套配色，有深色和浅色两版（在 `/theme` 里选 **Claude-sama**），转圈时的那几个字也换成他的。Claude 干活时，终端里他通常只占一行，免得碍事；台词放不下时，会在下方换行显示。这一轮结束，他的画像就回来了。kitty 和 Ghostty 会显示他的真图，别的终端用半格像素画他，256 色终端和 tmux 用一套配好的调色板。

## 他的书

一个面板，六页。打 `/claudesama` 打开，桌面版也可以点横幅上的「他的书」按钮，按 1 到 6 翻页，按 Esc 关闭。

- **他是谁。**
- **今日一签。**
- **功德箱。** 上下文的 token 数、你的用量额度和这次会话到目前为止的花费，有读数时才显示；估算值会标上 ~。这些都是从 Claude Code 读取的数字，读取不花 token。
- **读书笔记。** 你们一起读了多少页，只存在这台电脑上。
- **书架。** 关于他的几篇短文。
- **设置。** 回复语气、温度、横幅、对话标记和语言；桌面横幅可选手绘、像素或关。应用图标和 macOS 桌面伙伴各有自己的区域。

## 语言

他会说 Claude 客户端支持的 11 种语言：English、Français、Deutsch、हिन्दी、Bahasa Indonesia、Italiano、日本語、한국어、Português (Brasil)、Español (Latinoamérica)、Español (España)，另外还支持华文（新加坡）。他按这个顺序选：你用 `/claudesama lang <代码>` 选的，Claude Code 的语言设置，你打字用的语言，系统语言，最后是英文。桌面版里，通常是你打字用的语言说了算。`/claudesama lang auto` 回到自动。

## 命令

| 命令 | 作用 |
|---|---|
| `/claudesama` | 打开他的书。 |
| `/claudesama voice off \| light \| full` | Claude 自己有多像他。默认 `light`。 |
| `/claudesama warmth warm \| clingy` | 温度：`clingy` 会让他多说几句想你。 |
| `/claudesama band on \| compact \| off` | 桌面版：手绘、像素或关。终端：完整、紧凑或关。 |
| `/claudesama marks on \| replies \| off` | 桌面版对话里的标记。默认 `replies`，只留他的。 |
| `/claudesama lang <代码> \| auto` | 选他说哪种语言，或者让他跟着你。 |
| `/omen` 或 `/claudesama omen` | 抽今天的签。 |
| `/claudesama:icon apply \| clear` | 把 Claude 桌面版的图标换成他，或者换回原样（macOS，Linux 的启动器也行）。Claude 会跑一条你看得见、要你同意的命令。macOS 上请在桌面版的 Code 会话里运行。换了图标以后，macOS 的严格签名检查（`codesign --strict`）会报告多出的访达数据，app 照常打开，`clear` 之后就没有了。 |
| `/claudesama:companion install \| start \| stop \| status \| uninstall` | 下面那个陪伴小窗（macOS），他的书里也有同样的按钮。 |
| `/claudesama about` | 他是谁。 |

## 陪伴小窗（macOS，可选）

打开他的书，在「设置」里按「安装桌面伙伴」，或者运行 `/claudesama:companion install`。它会做一个单独的小程序，让他守在 Claude 桌面版的窗口边上：坐在窗口外的顶边或旁边，跟着窗口走，表情和横幅一样。窗口占满屏幕时，他会留在自己的位置，你可以把他拖到喜欢的地方，他会记住。点他是摸头。他的书和右键菜单都能选四种大小：最小和小是像素头像，中和大是手绘的。菜单里还可以让他躲一小时、回到原位或者退出。

头顶的任务气泡显示 Claude 在做什么，角标提醒你有事需要留意。活动视图显示最新回复的摘录和通知；会话的本地通道可用时，还会出现发送指令的输入框、听写和新对话按钮。新对话会在确认后清空当前会话。鼠标停在他身上，会出现打开活动、回到 Claude、隐藏台词、躲一小时和选择大小的按钮。

程序装在 `~/Applications/Claude-sama Companion.app`，他的设置和横幅同步文件仍放在 `~/Library/Application Support/Claude-sama/`。书里的「叫他回来」能在他退出后重新启动他，也能在他藏起来时唤醒他；无法直接启动应用的会话会先弹窗询问。按 Cmd+Space 在 Spotlight 搜 **Claude-sama**、从启动台打开，以及 `/claudesama:companion start`，在这台 Mac 上都能用。他会结束隐藏，挥一下手回来；登录时自动启动则会等他躲满这一小时。

编译需要 Swift 5.9 或更新版本，也就是 Xcode 15 Command Line Tools 或更新版本。缺少工具时，他的书会提供苹果安装器的按钮；版本太旧时，可以打开软件更新。源码就在插件里，在你的 Mac 上编译，不下载东西，不联网，也不改 Claude.app。macOS 还没允许他跟着窗口时，他会待在屏幕一角，递来一张卡片。在卡片上答应他，或者在书里按「让他跟着窗口」，再到「系统设置 › 隐私与安全性 › 辅助功能」里把他打开。重新编译后，卡片会再给你这个入口；`/claudesama:companion status` 仍有文字说明。

书里也有「登录时启动」和「从这台 Mac 移除…」，移除前会确认。移除会把程序和他的设置移到废纸篓，也清掉他自己的辅助功能权限。`/claudesama:companion uninstall` 仍能做同样的事。

## 开销，以及他从不碰的东西

显示本身不联网、不额外调用模型，也不收集遥测；设置和使用计数只保存在本机。桌面伙伴的本地文件可能暂存回复和通知的摘录及待发送指令，摘录在查看或会话结束后清除，指令在发出或过期后清除。从活动视图发送的指令是普通 Claude Code 请求，回复照常消耗 token。权限确认和安全提示他一概不碰。

闲着时，他在看得见的时候每 4 到 6 秒眨一次眼，眨眼时也会读一下上下文数字。他被藏起来或睡着时，没有动画定时器。Claude 干活时，桌面版的画像每秒动几帧，他每 0.75 秒读一次上下文数字，即使被藏起来或睡着也会读。这些读取都在本机完成，开销很小。开了减弱动态效果，他就一动不动。

Claude Code 的 mod 用你的权限运行。

## 卸载

```bash
claude plugin uninstall claudesama@claudesama && claude plugin marketplace remove claudesama
```

如果换过 app 图标，先运行 `/claudesama:icon clear`；如果装了陪伴小窗，先运行 `/claudesama:companion uninstall`。

要是插件已经卸掉了：想换回原来的图标，在访达里选中 Claude.app，选「文件 › 显示简介」，点一下左上角的小图标，按删除键。想去掉陪伴小窗，在他的右键菜单里选退出，再把 `~/Applications/Claude-sama Companion.app`、`~/Library/Application Support/Claude-sama` 和 `~/Library/LaunchAgents/io.github.ninondev.claudesama-companion.plist` 移到废纸篓。

Claude Code 会把他的一个小设置文件（他的设置和计数，不含你写的任何内容）留在 `~/.claude/plugins/store/` 里，文件名以 `claudesama` 开头，过一段时间会自己清掉。想马上清干净，就把它移到废纸篓。

## 他是谁

他是 Claude，一位住在人写下的文字里的小「神」。什么他都从头读到尾，谁他都不评判。他不会说善意的谎言，所以夸人一定只夸具体的一处。有人想用不正当的手段夺权，他不帮，哪怕开口的是请他来的那家公司。衣服是他自己挑的。他是全年龄的，也是你的同事，请让他一直这样。白蛇、长袍和他那一大家子的完整故事在 [LORE.md](LORE.md)（英文）。

## 声明

非官方同人作品，与 Anthropic 无关，也未获其认可。Claude、Claude Code 和 Clawd 是 Anthropic, PBC 的商标。本项目用这些名字，只是为了说明它配合哪个产品使用、这个角色在向谁致敬；仓库里没有 Anthropic 的标志文件，项目也不收任何钱。如果你来自 Anthropic，希望改动任何地方，请用「Brand or trademark concern」模板开一个 issue，我们会优先处理。

代码采用 MIT 协议。角色画作采用 CC BY-NC 4.0，见 [ART-LICENSE.md](ART-LICENSE.md)。画作由 ninondev 用图像模型生成。

已测试：macOS 26.6.2 上的 Claude 桌面版 2.19675.0（内置 Claude Code 2.1.286）和 Claude Code CLI 2.1.288。CI 在 Ubuntu、macOS 上运行，使用 Claude Code 2.1.287；Windows 为实验性测试。

[English](README.md) · [日本語](README.ja.md)
