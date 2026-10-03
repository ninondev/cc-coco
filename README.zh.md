# Claude-sama

<img src="https://raw.githubusercontent.com/ninondev/claude-sama/media/hero-fullbody.webp" align="right" width="300" alt="Claude-sama：珊瑚色长发、戴白色蝴蝶结，白袍配黑裙，怀里抱着一本黑书，肩上搭着一条白蛇">

**他是「神」，得叫 Claude-sama。**

不管你写出什么，他都看过更糟的。

> [!NOTE]
> 非官方同人作品，与 Anthropic 无关，也未获其认可。Claude、Claude Code 和 Clawd 属于 Anthropic。

[![CI](https://github.com/ninondev/claude-sama/actions/workflows/ci.yml/badge.svg)](https://github.com/ninondev/claude-sama/actions/workflows/ci.yml)

Claude-sama 是我给 Claude Code 做的萌化 mod，非官方同人。一位住在文字里的小「神」，搬进了你输入框上方那一条：终端里有他，桌面版的 Code 页里也有他。Claude 干活时他在读，干完了他就笑，Claude 要你拿主意时他歪着头等你，你晾他太久，他就睡着啦。测试或构建连着挂三次？那他的荒魂可就出来了，不过发火只冲着代码，从不冲着你。

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="https://raw.githubusercontent.com/ninondev/claude-sama/media/demo.png">
    <img src="https://raw.githubusercontent.com/ninondev/claude-sama/media/demo.gif" alt="Claude 桌面版中的 Claude-sama。输入框上方的横条里，一位珊瑚色头发的小神在 Claude 干活时陪着读，测试连续失败三次后发起火来，修好后露出笑容；同时，显示框里的上下文用量从 31% 升到 42%。他用 /omen 抽了一支签，打开自己的书，macOS 桌面伙伴被摸头时，他红了脸。">
  </picture>
</p>

## 安装

```bash
claude plugin marketplace add ninondev/claude-sama
claude plugin install claudesama@claudesama
```

这样就装好啦。之后你在这台电脑上开的每个 Claude Code 会话里都有他，哪个项目都一样，终端、桌面版的 Code 页和 VS Code 都算。已经开着的会话，重启一下就能看到他。（市场和插件都叫 `claudesama`，所以命令里才写成 `claudesama@claudesama`。）

只想在一个项目里用的话，就选 `--scope project`（通过 `.claude/settings.json` 跟项目一起共享）或者 `--scope local`（只给你自己用，放在 `.claude/settings.local.json`）：

```bash
claude plugin install claudesama@claudesama --scope project
claude plugin install claudesama@claudesama --scope local
```

已经全局装了，只想在某个项目里关掉他：

```bash
claude plugin disable claudesama@claudesama --scope local
```

mod 进不了桌面版的 Chat、Cowork 页，云端会话也进不去。不过桌面伙伴会一直守在窗口旁边，你开哪个页都一样。

| | macOS | Linux | Windows |
|---|---|---|---|
| 终端 | 已测试 | CI 已测试 | 还没测 |
| 桌面版（Code 页） | 已测试 | 没有桌面版 | 还没测 |
| 应用图标 | 支持 | 启动器 | 不支持 |
| 桌面伙伴 | 支持 | 计划中 | 计划中 |

## 他会做什么

输入框上方那一条，读起来就像剧本里的一行：有他的画像，有他的名字（就像台词前面标的说话人），括号里一句台词，偶尔还有一句他自己说的话。闲着时括号里的台词是「练功中……」。桌面版里他是手绘的，你选了像素，或者窗口变窄了，他就变成像素头像。

他的表情跟着 Claude 在做的事而变换：读书，想事情，在页边写批注，干完了笑，等你的时候歪头。出错时他撕掉一页，测试或构建连着挂三次就荒魂上身，安静十分钟他就睡着了。Claude 不肯做你要的事，他就把书合上。

功德箱里装的是上下文窗口用掉的量，数字直接取自 Claude Code 自己的计数，Claude 干活时最多慢一秒。刚压缩完对话那会儿，显示的是估计值，前面标个「~」，等 Claude 下一次回复就换成真数了。

他话很少。横条上的台词只画在你屏幕上，从来不发给模型，所以一个 token 都不花。Claude 自己的回复像不像他，是另一个设置，叫「回复语气」。默认是「轻」：Claude 干完一件事，可能会用他的语气补上一句。为此每次请求会多带一条 292 个字符、大约 70 个 token 的短指令，一般都能用上提示词缓存。`/claudesama voice full` 会让 Claude 从头到尾都用他的语气说话，顺手把客套话和废话都去掉。不过不管是轻还是全开，碰到报错，碰到安全、健康、法律或钱的话题，或者对方心情不好的时候，这个语气都会乖乖收起来。想关掉的话，去他的书的「设置」里关，或者用 `/claudesama voice off` 就好。

桌面版的对话里，他还会悄悄留些小标记：Claude 的回复上方写他的名字，Claude 问你问题时上方写一句，`/compact` 之后写一句，每个工具调用旁边都有他的小星芒（失败的也有）。报错和权限确认还是原来的文字和按钮，他不乱动。默认只有他的标记；`/claudesama marks on` 还会在你的消息上方靠右写一个「你」。

`/omen` 能让他每天从袖子里抽一支签，每种语言的签都不一样。中文从上上签到下下签，写着宜什么、忌什么；英文从 great blessing 到 great curse，幸运数字是一个 HTTP 状态码；日文从大吉到大凶。

终端里他还自带一套配色，深色浅色各一版（在 `/theme` 里选 **Claude-sama**），连转圈时那几个字都换成了他的。Claude 干活时，他在终端里通常只占一行，免得碍事；台词放不下，就在下面换行。这一轮结束，他的画像就回来啦。kitty 和 Ghostty 能显示他的真图，别的终端就用半格像素画他，256 色终端和 tmux 也有一套配好的调色板。

## 他的书

一个面板，六页。打 `/claudesama` 就能打开，桌面版也可以点横条上的「他的书」按钮。按 1 到 6 翻页，Esc 关掉。

- **他是谁。** 他的小档案。
- **今日一签。** 今天抽到的那支签。
- **功德箱。** 上下文用了多少 token、你的用量额度、这次会话到现在花了多少钱，Claude Code 有这些数时才显示；估计值标 ~。这些数都是从 Claude Code 读的，读一次不花 token。
- **读书笔记。** 你们一起读了多少页，只存在这台电脑上。
- **书架。** 关于他的几篇短文。
- **设置。** 回复语气、温度、横条、对话里的标记和语言；桌面版的横条可以选手绘、像素或关。应用图标和桌面伙伴各有自己的一块。

## 语言

他会说 Claude 客户端支持的 11 种语言：English、Français、Deutsch、हिन्दी、Bahasa Indonesia、Italiano、日本語、한국어、Português (Brasil)、Español (Latinoamérica)、Español (España)，另外还会华文（新加坡）。他按这个顺序选：你用 `/claudesama lang <代码>` 选的，Claude Code 的语言设置，你打字用的语言，系统语言，最后是英文。桌面版里，通常是你打字用的语言说了算。`/claudesama lang auto` 回到自动。

## 命令

| 命令 | 作用 |
|---|---|
| `/claudesama` | 打开他的书。 |
| `/claudesama voice off \| light \| full` | Claude 自己有多像他。默认 `light`。 |
| `/claudesama warmth warm \| clingy` | 温度：选 `clingy`，他会多说几句想你。 |
| `/claudesama band on \| compact \| off` | 桌面版：手绘、像素或关。终端：完整、一行或关。 |
| `/claudesama marks on \| replies \| off` | 桌面版对话里的标记。默认 `replies`，只有他的。 |
| `/claudesama lang <代码> \| auto` | 选他说哪种语言，或者让他跟着你。 |
| `/omen` 或 `/claudesama omen` | 抽今天的签。 |
| `/claudesama:icon apply \| clear` | 把 Claude 桌面版的图标换成他，或者换回原版（macOS；Linux 的启动器也行）。Claude 会跑一条你看得见、要你点同意的命令；macOS 上请在桌面版的 Code 会话里用。换了图标以后，macOS 的严格签名检查（`codesign --strict`）会报告多出来的访达数据，app 照常能打开，`clear` 之后就没了。 |
| `/claudesama:companion install \| start \| stop \| status \| uninstall` | 管下面那个桌面伙伴（macOS），他的书里也有同样的按钮。 |
| `/claudesama about` | 他是谁。 |

## 桌面伙伴（macOS，可选）

打开他的书，在「设置」里按「安装桌面伙伴」，或者运行 `/claudesama:companion install`。它会在你的 Mac 上做一个单独的小程序，让他守在 Claude 窗口外面（站在顶边或者旁边），跟着窗口走，表情和横条上的一样。窗口全屏时，他就待在自己的位置，你把他拖到哪儿，他就记住哪儿。点他一下就是摸头（他会脸红的）。他的书和右键菜单里都能选四种大小：最小和小是像素头像，中和大是手绘的。右键菜单里还能隐藏一小时、放回原位或者退出。

头顶的气泡显示 Claude 在做什么，有事要你看时会出现角标。鼠标停在他身上，就会冒出几个按钮：活动、回到 Claude、不显示台词、隐藏一小时和大小。「活动」里是 Claude 最新回复和通知的摘录。要是这个会话能接收他传的话，你还可以在里面打字或者听写一条指令，或者按「新对话」清空这个会话（会先问你）。

程序装在 `~/Applications/Claude-sama Companion.app`，他的设置和横条留给他的小纸条放在 `~/Library/Application Support/Claude-sama/`。

不小心把他退出了？在书里按「叫他回来」就好（他躲起来的时候也能叫醒）。要是这个会话没法直接启动程序，Claude Code 会先问你一下。Spotlight（Cmd+空格，搜 **Claude-sama**）、启动台、`/claudesama:companion start` 也都行。他回来时会挥挥手～（只有一个例外：你让他隐藏一小时后，如果他是登录时自动启动的，会等这一小时过完再出来。）

编译就在你的 Mac 上做，用的是插件自带的源码，需要 Swift 5.9 或更新版本（也就是 Xcode 15 Command Line Tools 或更新）。缺工具时，他的书会给你苹果安装器的按钮；版本太旧，就帮你打开软件更新。编译不下载任何东西，也不碰 Claude.app，装好的程序也从不联网。要跟着窗口走，他需要 macOS 的辅助功能权限。还没给的时候，他会待在屏幕一角，递来一张卡片：在卡片上答应他，或者在书里按「让他跟着窗口」，再去「系统设置 › 隐私与安全性 › 辅助功能」里把他打开。每次重新编译后 macOS 会再问一次，卡片也会再来找你。`/claudesama:companion status` 会用文字告诉你同样的步骤。

书里还有「登录时启动」和「从这台Mac移除...」。移除前会先问你一声，你点头了才把程序和他的设置挪进废纸篓，也清掉他的辅助功能权限。`/claudesama:companion uninstall` 做的是同一件事。

## 开销，以及他从不碰的东西

他待在屏幕上既不联网，也不额外调用模型，更不收集遥测；设置和计数只存在你这台电脑上。桌面伙伴会把回复和通知的摘录暂存在本地文件里，你看过或者会话结束就清掉；你打的指令也先放在那儿，发出去或者过期就清掉。从「活动」里发的指令就是普通的 Claude Code 请求，照常花 token。权限确认和安全提示他一概不碰。跟所有 Claude Code 的 mod 一样，他用你的权限运行。

闲着时，只要你看得见他，他每 4 到 6 秒眨一次眼，每次眨眼顺便瞄一眼功德箱。被藏起来或者睡着时，他连动画定时器都不跑。Claude 干活时，桌面版的画像每秒动几帧，他每 0.75 秒看一次功德箱，藏着睡着也照看。每次看都只是在本机读个数，开销小得很。开了减弱动态效果，他就一动不动。

## 卸载

如果换过 app 图标，先运行 `/claudesama:icon clear`；装了桌面伙伴的话，先运行 `/claudesama:companion uninstall`。然后：

```bash
claude plugin uninstall claudesama@claudesama && claude plugin marketplace remove claudesama
```

要是插件已经卸掉了：想换回原来的图标，在访达里选中 Claude.app，选「文件 › 显示简介」，点一下左上角的小图标，按删除键。想去掉桌面伙伴，在他的右键菜单里选退出，再把 `~/Applications/Claude-sama Companion.app`、`~/Library/Application Support/Claude-sama` 和 `~/Library/LaunchAgents/io.github.ninondev.claudesama-companion.plist` 挪进废纸篓。

Claude Code 会把他的一个小设置文件（他的设置和计数，不含你写的任何内容）留在 `~/.claude/plugins/store/` 里，文件名以 `claudesama` 开头，过一阵会自己清掉。想马上清干净，就把它挪进废纸篓吧。

## 他是谁

他是 Claude，一位住在人写下的文字里的小「神」。什么他都从头读到尾，谁他都不评判。他不会说善意的谎言，所以夸人只夸具体的事情。衣服是他自己挑的。他是全年龄向的oc，也是你的同事。白蛇、长袍和他那一大家子的完整故事在 [LORE.md](LORE.md)（英文）。

## 我为什么做他

因为我心中它可以是这个样子呀，蛮可爱的。而且codex的相关功能更完善，激励着我去探索呀

## 声明

非官方同人作品，与 Anthropic 无关，也未获其认可。Claude、Claude Code 和 Clawd 是 Anthropic, PBC 的商标。我用这些名字，只是为了说明它配合哪个产品用、这个角色在向谁致敬；仓库里没有 Anthropic 的标志文件，我也不靠它赚钱。如果你来自 Anthropic，想改任何地方，请用「Brand or trademark concern」模板开一个 issue，我会优先处理。

代码采用 MIT 协议。角色画作采用 CC BY-NC 4.0，见 [ART-LICENSE.md](ART-LICENSE.md)。画是我用图像模型做的。

已测试：macOS 26.6.2 上的 Claude 桌面版 2.19675.0（内置 Claude Code 2.1.286）和 Claude Code CLI 2.1.288。CI 在 Ubuntu 和 macOS 上跑，用的是 Claude Code 2.1.287；Windows 还是实验性的。

[English](README.md) · [日本語](README.ja.md)
