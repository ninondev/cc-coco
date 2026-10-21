# Coco

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="https://raw.githubusercontent.com/ninondev/cc-coco/media/demo.png">
    <img src="https://raw.githubusercontent.com/ninondev/cc-coco/media/demo.gif" width="720" alt="小克在 Claude 桌面版里。让 Claude 修挂掉的测试，它找到少算一位的 bug，三个测试全过；小克在输入框上方的横条里托着腮看。">
  </picture>
</p>

在你的终端输入框上方，住着小小一只小克。

她总能比你先一步嗅出 bug，然后得意地冲你翘尾巴。这是一个为 Claude Code 打造的非官方同人桌宠伴侣 mod。

> [!NOTE]
> 非官方同人作品，与 Anthropic 无关，也未获其认可。Claude、Claude Code 和 Clawd 属于 Anthropic。

## 安装

```bash
claude plugin marketplace add ninondev/cc-coco
claude plugin install coco@coco
```

装好之后，这台电脑上新开的每个 Claude Code 会话（无论是终端还是桌面版）里都会有她。已经开着的会话重启一下就行。

只想在单个项目里用：`--scope project`；只给自己用、不写进项目共享配置：`--scope local`。全局安装后想在某个项目里单独关掉她：

```bash
claude plugin disable coco@coco --scope local
```

受客户端机制限制，mod 无法进入桌面版的 Chat、Cowork 页以及云端会话；不过桌宠 Coco Pet 不受此限制，会一直待在你桌面上。

| | macOS | Windows | Linux |
|---|---|---|---|
| 终端 | 已实测 | CI 已测 | CI 已测 |
| 桌面版（Code 页） | 已实测 | 未实测 | 未实测 |
| 桌宠 Coco Pet | 已实测 | 未实测 | 未实测 |
| 换 Claude 图标（默认关） | 支持 | 不支持 | 支持（改启动器） |

需要 Claude Code 2.1.299 或更高版本。查看版本：终端里打 `claude --version`，桌面版在 Code 页打 `/status`。Linux 上使用桌宠或自定义 API key，系统需 Debian 10、Ubuntu 20.04 或更高版本（glibc 2.28 起）。

更新 Claude Code：

- 终端：`claude update`。官方安装器装的平时会自己更新；npm、Homebrew、WinGet 装的，分别用 `npm install -g @anthropic-ai/claude-code@latest`、`brew upgrade claude-code`、`winget upgrade Anthropic.ClaudeCode`。
- 桌面版：Code 页用的是桌面应用自带的那份，跟终端里的是两份，要分开更新。macOS 点 Claude › Check for Updates，Windows 点 Help › Check for Updates，然后开一个新会话；这两个系统的桌面版每次启动也会自己更新。Linux 桌面版用 `sudo apt update && sudo apt upgrade`。

## 她会做什么

装上之后，你的命令提示符上方会多出一条横栏：她就坐在那儿的马克杯沿上晃着小腿，陪你写代码、解闷斗嘴。

她的神态动作会随 Claude 的工作状态实时同步：读文件时眼珠跟着字走，长考时吐出小泡泡，一开工就掏出轻薄本狂敲，跑通后还会得意地把屏幕转过来向你邀功。遇到报错她会咻地钻进纸箱；要是测试连挂三次，头上的键帽限制器就会当场崩飞、冲着烂代码暴走；若是终端安静四五分钟，她便拉下兜帽缩成一团打盹，只留两根呆毛在外面慢慢垂落。

每当 Claude 拒绝执行请求（HTTP 418），她还会把茶壶盖扣在脑袋上生闷气。

桌面版内置了全套手绘动画，你可以随时用鼠标戳她逗乐，或者摸摸她的头。

横条上的所有日常台词均在本地直接渲染，不调用模型接口，真正零 token 消耗。

横条右边挂着两个小挂件：电池是 5 小时额度，充电宝是一周额度，电量格照真实余量画。鼠标移上去，能看到几点重置、照现在的速度撑不撑得到重置。上下文用了多少也写在横条上。

她闲着会打盹，睡着时横条上偶尔有访客：走丢的键帽、纸飞机、404 小幽灵、迷路的鼠标箭头……晚上还有一闪一闪的 USB 小灯。

桌面版的对话里，她喜欢的注释旁边有一颗小星芒；测试或构建由红转绿时，下面开一朵小花。报错和权限确认还是原来的样子，她不乱动。

终端里还有一套她的配色，在 `/theme` 里选 Coco，浅色背景选 Coco (light)。

## 小克的痛包

打 `/coco` 打开设置，就能拉开「小克的痛包」。一共七页：

- **小克**：她的资料、桌宠 Coco Pet、陪你做的事（专注、技能卡片、日记）。也能在这里换成大克（终端里还是小克），或切换痛包的插画样式。
- **额度**：5 小时和一周额度、这次会话用了多少、价格表。
- **vibe check**：这次会话的战绩，测试挂了几次、修好几次、把她逼到黑化几次、构建比平时快还是慢，能存成图分享。
- **袜子**：十三双袜子，做到对应的「第一次」就得一双，点一双她就换上。
- **同人誌**：每周一期，记着你们这一周。
- **便利贴**：新会话开始时，她告诉你上次停在哪。只存在这台电脑上。
- **开关**：所有开关按用途分组，会花 token 的都标出来。

技能卡片有自己的面板：按「小克」页上的「技能卡片」或打 `/coco cards`。她把你手边的技能、子代理和斜杠命令做成一张张卡片。技能和子代理的卡片放进托盘就会在下一条提示词中调用；命令的卡片按「写进输入框」，命令就替你打在输入框里，按回车才运行。图鉴里记着每张用过几次。

## 默认关着的功能

都在痛包的「开关」页。会用到你额度的都写明，默认用最新的 Haiku，也能换别的模型。

- **小窗**：开小窗找她聊天，她会用你选的模型回复。她有时会主动先开口，也记得上次聊到哪。支持用你自己的 API key 计费，key 存在系统自带的密码库里（Mac、Linux 是钥匙串，Windows 是凭据管理器；Linux 没有钥匙串时存为仅当前账户可读的文件）。自定义 key 在 Windows 和 Linux 上暂未真机实测。
- **台词库**：让模型给小克或大克写一套专属横条台词，保存在本机，自己也能随时修改或恢复默认。
- **回复语气**：设为「开」时，Claude 做完事她会顺嘴补一句（每次请求附带一段 338 字符的说明，通常直接走缓存读取）；设为「全开」时，Claude 全程都会用她的口气说话。
- **简单解释**：一键把 Claude 的上一条回复或你选中的内容翻成大白话，不影响主对话。
- **二次检查**：Claude 改完文件后，一键让另一个模型帮忙审阅改动，列出值得留意的地方。
- **说人话**：切换成不懂编程的人也能轻松看懂的回复风格。
- **超额确认**：给会话设一条消费线，超线时她会先拦住 Claude 的下一步，问你要不要继续。
- **隐藏密钥**：粘贴的内容里如果有常见格式的密钥，发出去之前她会主动提醒你，支持一键打码遮住。
- **缓存保温**：你暂离时她定时在后台重读缓存，等你回来继续发消息时依然能享受便宜的缓存读取价。实测开启时缓存命中率 99.8%，关闭时 23%。遇到电脑锁屏、满两小时或切去别的对话时自动停保。
- **邻居的灯**：别的编程助手在干活时，她也能看到动静。只看有没有在忙和剩余额度，不看具体内容，也不外发。

## 隐私和开销

默认状态下，她待在屏幕上不额外调用模型、不联网、不收集遥测，关于你的任何内容都不会离开这台电脑。

开关页里会调用模型的功能，只有你打开以后才走你的额度，每一个都在界面上写明花多少。权限确认和安全提示她一概不碰。

她闲着才眨眼，大约五秒一次，像人读书时那样。被藏起来或睡着时不跑动画。开了系统的「减弱动态效果」，她就保持不动。

开启 Claude Code 的读屏模式（环境变量或设置）后，她的横条自动变成纯文字。如果只用了启动参数，在开关页的「输入框上方横条」里选「文字」。

## 语言

13 种语言，简中叫「华文」，繁中叫「國語」，其余跟 Claude 客户端一样。`/coco lang auto` 回到自动。

## 桌宠 Coco Pet

在痛包「小克」页按「安装Coco Pet」，或者 `/coco companion install`。她待在 Claude 窗口旁边，跟着窗口走，表情和横条上的一样。可以摸头、拖着走，三档大小。

不下载任何东西，不碰 Claude 应用本体，装好的程序从不联网。Windows 和 Linux 版我手边没有电脑，还没在真机上看过。

不小心退掉了，在痛包里点一下「叫她回来」就好啦。

## 换 Claude 图标

默认关。四个可选：小克、大克、小克的键帽、大克的发饰。macOS 上会在 Claude.app 里写一个小图标文件，Claude 更新后原版图标会回来，按一下重新换上，随时可以还原。Linux 只改你自己的启动器文件，不碰应用本体。

## 网页皮肤

「小克配色」是给 claude.ai 网页版用的皮肤：换上一套专属颜色和字体（浅色、深色模式皆有），宽窗口里右下角会坐着一只像素小克。先给浏览器装一个用户样式扩展（如 Stylus），再在 GitHub 上打开本仓库的 `skins/claude-ai/coco.user.css` 并点击 Raw，扩展就会询问是否安装。它只改页面样式，不读取页面内容，也不联网；不想要了在扩展里删掉就行。这款皮肤还没在真实的 claude.ai 页面上实测过。

## 卸载

换过 Claude 图标的话先 `/coco icon clear`；装了桌宠先 `/coco companion uninstall`；存过自己的 API key，先在痛包里把它删除。然后：

```bash
claude plugin uninstall coco@coco && claude plugin marketplace remove coco
```

插件已经不在了的话：想换回图标，在访达里选中 Claude.app，打开「文件 › 显示简介」，点左上角的小图标按删除键。想去掉桌宠，右键退出，再把这些挪进废纸篓（Windows 是回收站）：

- macOS：`~/Applications/Coco Pet.app`、`~/Library/Application Support/Coco`、`~/Library/Application Support/Coco-presence`
- Windows：`%LOCALAPPDATA%\Programs\Coco Pet`、`%APPDATA%\Coco`、`%USERPROFILE%\.local\state\coco`
- Linux：`~/.local/share/coco-pet`、`~/.local/state/coco`、`~/.config/coco-pet`

## 更新展望

这几样 1.0 还没有，之后的版本再做：

- **更多聊天伙伴**：10 位以上来自别家的聊天伙伴会来串门，各接各家的模型（使用你自己的 key），聊天时横条上也会换成她的身影。她们的故事以后慢慢讲。
- **等待小游戏。** Claude 干活的时候能玩一会儿。
- **桌宠的小彩蛋。** 按住 Option 点她，会有别的反应。
- **Windows 与 Linux 版桌宠的真机实测与代码签名。**

## 她是谁

她是你的同事。完整的故事在 [LORE.zh.md](LORE.zh.md)

## 我为什么做她

因为我心中它可以是这个样子呀，蛮可爱的。Codex 那边相关的功能都齐了，我就想自己也做一个呗。

## 声明

非官方同人作品，与 Anthropic 无关，也未获其认可。Claude、Claude Code 和 Clawd 是 Anthropic, PBC 的商标。我用这些名字，只是为了说明它配合哪个产品用、这个角色在向谁致敬。仓库里没有 Anthropic 的标志文件，我也不靠它赚钱。如果你来自 Anthropic，想改任何地方，请用「Brand or trademark concern」模板开一个 issue，我会优先处理。

大克的造型出自 ZipZipPipe 的 Claude 娘《[Claude 拟人立绘·橘白礼服ver](https://www.bilibili.com/opus/1239937623660691478)》，设计归 [ZipZipPipe](https://space.bilibili.com/4168597)，转发时请一起署名，不可商用。友情网站：[蓝色大肥鱼.com](https://蓝色大肥鱼.com)

代码采用 MIT 协议。角色画作采用 CC BY-NC 4.0，见 [ART-LICENSE.md](ART-LICENSE.md)。画是我用图像模型做的。

实测过的版本：Claude Code 2.1.302（整套测试）和 2.1.299。桌面版最后一次在真机上看是 2026 年 10 月 20 日。

[English](README.md)、[日本語](README.ja.md)
