# Coco

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="https://raw.githubusercontent.com/ninondev/cc-coco/media/demo.png">
    <img src="https://raw.githubusercontent.com/ninondev/cc-coco/media/demo.gif" width="720" alt="小克在 Claude 桌面版里。让 Claude 修挂掉的测试，它找到少算一位的 bug，三个测试全过；小克在输入框上方的横条里托着腮看。">
  </picture>
</p>

你的终端输入框上面，住着小小一只小克。

你的 bug 她总要瞅上一眼，然后冲你竖起呆毛得意半天。这是我给 Claude Code 做的桌宠 mod。

> [!NOTE]
> 非官方同人作品，与 Anthropic 无关，也未获其认可。Claude、Claude Code 和 Clawd 属于 Anthropic。

## 安装

```bash
claude plugin marketplace add ninondev/cc-coco
claude plugin install coco@coco
```

装好之后，不管是终端还是桌面版，新开会话就能看到她。已经开着的会话重启一下就行。

只想在当前项目里用，加 `--scope project`；只给自己用、不写进项目的共享配置，加 `--scope local`。如果装了全局版，想在某个项目里单独关掉她：

```bash
claude plugin disable coco@coco --scope local
```

桌面版的 Chat、Cowork 页和云端会话加载不了插件，所以里面没有她；不过独立桌宠 Coco Pet 不受这个限制，会一直待在你桌面上。

| | macOS | Windows | Linux |
|---|---|---|---|
| 终端 | 已实测 | CI 已测 | CI 已测 |
| 桌面版（Code 页） | 已实测 | 未实测 | 未实测 |
| 桌宠 Coco Pet | 已实测 | 未实测 | 未实测 |
| 换 Claude 图标（默认关） | 支持 | 不支持 | 支持（改启动器） |

需要 Claude Code 2.1.299 或更高版本。查版本号：终端运行 `claude --version`，桌面版在 Code 页输入 `/status`。在 Linux 上用桌宠或存自己的 API key，系统需 Debian 10、Ubuntu 20.04 或更新版本（glibc 2.28 起）。

更新 Claude Code：

- 终端：直接跑 `claude update`。用官方安装器装的平时会自动更新；用 npm、Homebrew、WinGet 装的，分别跑 `npm install -g @anthropic-ai/claude-code@latest`、`brew upgrade claude-code`、`winget upgrade Anthropic.ClaudeCode`。
- 桌面版：Code 页用的是桌面应用里自带的那套，跟终端版各管各的，得用应用自己的更新。macOS 点 `Claude › Check for Updates`，Windows 点 `Help › Check for Updates`，更完新开一个会话；平时每次启动应用它也会自己检查更新。Linux 桌面版用 `sudo apt update && sudo apt upgrade`。

## 她会做什么

装好以后，输入框上面会多出一条横条：她坐在马克杯沿上晃着小腿，陪你写代码、斗嘴解闷。

她的动作跟着 Claude 的状态走：读文件时眼睛跟着字转，长考时吐小泡泡，一开工就掏出轻薄本猛敲，干完了得意地把屏幕转过来给你邀功。遇到报错她就钻纸箱；测试连挂三次，头上的键帽限制器当场弹飞，冲着烂代码暴走；要是终端安静了四五分钟，她就把兜帽拉下来缩成一团打盹，只剩两根呆毛在外面慢慢趴下。

Claude 拒绝干活的时候（HTTP 418），她会把茶壶盖扣在脑袋上生闷气。

桌面版里是全套手绘动画，平时能拿鼠标戳她，或者摸摸头。

横条上的日常台词全在本地直接画出来，不调模型，不花一分钱 token。

横条右边挂着两个电量挂件：小电池是 5 小时额度，充电宝是一周额度，剩多少就亮几格。鼠标放上去，能看到几点重置、按现在的消耗速度能不能撑到重置。上下文用了多少也写在旁边。

她闲下来会打盹，睡着时横条上偶尔有小东西路过：走丢的键帽、纸飞机、404 小幽灵、迷路的鼠标指针……到了夜里还会亮起一闪一闪的 USB 小灯。

桌面版的对话里，她中意的注释旁边会亮一颗小星芒；测试或构建由红转绿时，底下会开一朵小花。报错和权限确认还是原来的样子，她绝不乱动。

终端里还带了一套她的配色，打 `/theme` 选 `Coco`，浅色背景选 `Coco (light)`。

## 小克的痛包

打 `/coco` 打开设置，就能拉开「小克的痛包」。里面一共七页：

- **小克**：她的资料、桌宠 Coco Pet、陪你做的事（专注计时、技能卡片、日记）。也能在这儿把横条和桌宠换成大克（终端里还是小克），或者换痛包的插画。
- **额度**：5 小时和一周额度明细、这次会话花了多少、模型价格表。
- **vibe check**：这次会话的战绩：测试挂了几次、修好几次、把她逼到黑化几次、构建比平时快还是慢，还能存成图片发出去。
- **袜子**：十三双袜子，达成对应的「第一次」就解锁一双，点哪双她就换哪双。
- **同人誌**：每周一期，记下你们这一周干了什么。
- **便利贴**：开新会话时，提醒你上次停在哪儿。只存在本机。
- **开关**：所有开关按用途分好组，会花 token 的都标出来了。

技能卡片有单独的面板：点「小克」页里的「技能卡片」或打 `/coco cards`。她把你现有的技能、子代理和斜杠命令做成了一副牌。挑中技能或子代理放进托盘，发下一条消息时就会自动带上；命令卡点「写进输入框」，就会直接帮你填好，按回车才跑。图鉴里记着每张卡用过多少次。

## 默认关着的功能

全在痛包的「开关」页里。会花额度的都标了，默认走最便宜的 Haiku，也能自己换模型。

- **小窗**：开小窗找她闲聊，用你选的模型回。她有时会自己先开口，也记得上次聊到哪。支持填你自己的 API key 付钱，key 存在系统自带的密码库里（Mac、Linux 走钥匙串，Windows 走凭据管理器；Linux 没装钥匙串时存成仅当前账户可读的文件）。自带 key 在 Windows 和 Linux 上还没真机测过。
- **台词库**：让模型给小克或大克写一套横条台词，存在本机，自己随时能改，也能一键恢复原样。
- **回复语气**：开：Claude 干完活她顺嘴补一句（每次请求多带一段 338 字符的说明，一般直接走缓存）。全开：Claude 全程用她的口气跟你说话。
- **简单解释**：一键把 Claude 的上一条回复（或你选中的内容）翻成大白话，不插进主对话里。
- **二次检查**：Claude 改完文件后，一键叫另一个模型帮忙看一眼改动，挑出值得留心的地方。
- **说人话**：切换成不写代码的人也能看懂的回复方式。
- **超额确认**：给当前会话设一条消费线，超了她先替你拦住 Claude，问你要不要继续。
- **隐藏密钥**：粘贴的内容里要是带有常见格式的密钥，发出去前她会先提醒你，可以一键打码。
- **缓存保温**：你暂离时她定时在后台重读缓存，等你回来接着聊，读取还是按便宜的缓存价算。实测开着时缓存命中率 99.8%，关着时 23%。遇到电脑锁屏、离开满两小时或切去聊别的对话，就会自动停掉。
- **邻居的灯**：电脑上别的编程助手在干活时，她也能瞅见。只看忙不忙和剩多少额度，不看内容，也不外传。

## 隐私和开销

默认状态下，她待在屏幕上不调模型、不联网、不发统计数据，她自己不会把你的任何内容传出这台电脑。

「开关」页里要调模型的功能，只有你亲手打开才走你的额度，花多少在界面上都写得明明白白。权限确认和安全提示她一概不碰。

平时只有闲着她才眨眼，大概五秒一次。窗口被挡住或者她睡着了，动画就停；系统开了「减弱动态效果」，她就乖乖不动。

开了 Claude Code 的读屏模式（环境变量或设置）后，横条会自动切成纯文字。如果只传了启动参数，可以在开关页的「输入框上方横条」里选「文字」。

## 语言

支持 13 种语言：简中叫「华文」，繁中叫「國語」，其余跟 Claude 客户端一样。打 `/coco lang auto` 切回自动。

## 桌宠 Coco Pet

在痛包「小克」页点「安装Coco Pet」，或者打 `/coco companion install`。她会待在 Claude 窗口边上跟着窗口走，表情跟横条里同步；能摸头、能拖着走，有三档大小。

安装过程不下载外部文件、不改 Claude 应用本体，装好的桌宠也从不联网。Windows 和 Linux 版我手头没机器，还没在真机上试过。

不小心关掉了，去痛包里点一下「叫她回来」就行。

## 换 Claude 图标

默认关闭。有四款可选：小克、大克、小克的键帽、大克的发饰。macOS 上会往 `Claude.app` 里塞一个小图标文件，Claude 更新后会自动变回原版图标，再点一下就能重新换上，平时也能随时还原。Linux 只改你自己的桌面启动器文件，不碰应用本体。

## 网页皮肤

「小克配色」是给 claude.ai 网页版用的皮肤：换上一套专属颜色和字体（浅色、深色模式皆有），宽窗口里右下角会坐着一只像素小克。先给浏览器装一个用户样式扩展（如 Stylus），再在 GitHub 上打开本仓库的 `skins/claude-ai/coco.user.css` 并点击 Raw，扩展就会询问是否安装。它只改页面样式，不读取页面内容，也不联网；不想要了在扩展里删掉就行。这款皮肤还没在真实的 claude.ai 页面上实测过。

## 卸载

换过图标的话先跑 `/coco icon clear`；装了桌宠先跑 `/coco companion uninstall`；存过自己的 API key，先去痛包里删掉。然后运行：

```bash
claude plugin uninstall coco@coco && claude plugin marketplace remove coco
```

要是已经先把插件删了：想还原图标，在访达里选中 `Claude.app`，打开「文件 › 显示简介」，点左上角的小图标按退格键；想删掉桌宠，右键退出后，把下面这些目录丢进废纸篓（Windows 是回收站）：

- macOS：`~/Applications/Coco Pet.app`、`~/Library/Application Support/Coco`、`~/Library/Application Support/Coco-presence`
- macOS 上再在终端跑一下 `security delete-identity -c "Coco Pet Local Signing"`，删掉桌宠在登录钥匙串里建的签名证书
- Windows：`%LOCALAPPDATA%\Programs\Coco Pet`、`%APPDATA%\Coco`、`%USERPROFILE%\.local\state\coco`
- Linux：`~/.local/share/coco-pet`、`~/.local/state/coco`、`~/.config/coco-pet`

## 更新展望

这几样 1.0 还没做，留在后面的版本：

- **更多聊天伙伴**：十多位别家模型的角色会来串门，各接各家的 API（用你自己的 key），聊谁横条上就换成谁。她们的故事以后慢慢讲。
- **等待小游戏**：Claude 干活的时候能顺手玩两把。
- **桌宠小彩蛋**：按住 Option 点她，会有不一样的反应。
- **Windows 与 Linux 桌宠的真机实测和签名。**

## 她是谁

她是陪你写代码的搭档。完整的设定在 [LORE.zh.md](LORE.zh.md)。

## 我为什么做她

因为我心里觉得它就该是这个样子呀，蛮可爱的。Codex 那边类似的功能都齐了，我就想自己动手也做一个呗。

## 声明

非官方同人作品，与 Anthropic 无关，也未获其认可。Claude、Claude Code 和 Clawd 是 Anthropic, PBC 的商标。提到这些名字，只是为了说明插件配合哪个工具用、角色在向谁致敬。仓库里不含 Anthropic 的标志文件，也不靠这个赚钱。如果你来自 Anthropic，觉得哪里不妥，请用「Brand or trademark concern」模板提个 issue，我会第一时间处理。

大克的造型来自 ZipZipPipe 的 Claude 娘《[Claude 拟人立绘·橘白礼服ver](https://www.bilibili.com/opus/1239937623660691478)》，设计归 [ZipZipPipe](https://space.bilibili.com/4168597)，转发请一并署名，不可商用。友情网站：[蓝色大肥鱼.com](https://蓝色大肥鱼.com)

代码采用 MIT 协议。角色画作采用 CC BY-NC 4.0，只有小克房间里大肥鱼的那两张图采用 CC BY-NC-SA 4.0，详见 [ART-LICENSE.md](ART-LICENSE.md)。画是我用图像模型生成的。

实测过的版本：Claude Code 2.1.302（跑完完整测试）和 2.1.299。桌面版最后一次在真机上看是 2026 年 10 月 20 日。

[English](README.md)、[日本語](README.ja.md)
