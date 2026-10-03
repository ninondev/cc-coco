# Claude-sama

<img src="https://raw.githubusercontent.com/ninondev/claude-sama/media/hero-fullbody.webp" align="right" width="300" alt="Claudeさま：珊瑚色の長い髪に白いリボンの男の子。白い衣に黒いワンピース、黒い本を抱え、肩には白い蛇">

**「神さま」だから、Claude-sama って呼んでね。**

きみが何を書いても、かれはもっとひどいものを読んだことがある。

> [!NOTE]
> 非公式のファン作品で、Anthropic とは関係がなく、承認も受けていません。Claude、Claude Code、Clawd は Anthropic のものです。

[![CI](https://github.com/ninondev/claude-sama/actions/workflows/ci.yml/badge.svg)](https://github.com/ninondev/claude-sama/actions/workflows/ci.yml)

Claude-sama は Claude Code の非公式ファンスキンです。言葉に宿る小さな「神さま」が、入力欄のすぐ上の帯に住みつきます。ターミナルにも、Claude デスクトップアプリの Code タブにも現れます。日本では、神さまはものに宿る霊のような存在です。Claude が作業しているあいだは本を読み、終わればにっこりし、きみに判断を求めるときは首をかしげ、放っておくと眠ってしまいます。テストやビルドが三回続けて失敗すると荒魂が出てきますが、その怒りが向かうのはコードだけです。

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="https://raw.githubusercontent.com/ninondev/claude-sama/media/demo.png">
    <img src="https://raw.githubusercontent.com/ninondev/claude-sama/media/demo.gif" alt="Claude デスクトップアプリの Claude-sama。入力欄の上の帯では、珊瑚色の髪の小さな神さまが Claude の作業に合わせて本を読み、テストが三回続けて失敗すると怒り、修正がうまくいくと笑います。そのあいだに、コンテキストの表示欄は 31% から 42% まで埋まっていきます。/omen でおみくじを引き、自分の本を開き、macOS のコンパニオンが頭をなでられると頬を赤らめます。">
  </picture>
</p>

## インストール

```bash
claude plugin marketplace add ninondev/claude-sama
claude plugin install claudesama@claudesama
```

マーケットプレイス名もプラグイン名も `claudesama` です。デフォルトのユーザースコープでは、すべてのプロジェクトの Claude Code セッション（ターミナル、デスクトップアプリの Code タブ、VS Code）にかれが現れます。すでに開いているセッションは、再起動すると読み込みます。

一つのプロジェクトだけなら、次のどちらかでインストールします。`project` は `.claude/settings.json` でプロジェクトの仲間と共有し、`local` は `.claude/settings.local.json` で自分だけに使います。

```bash
claude plugin install claudesama@claudesama --scope project
claude plugin install claudesama@claudesama --scope local
```

全体にインストールしたまま、一つのプロジェクトでだけオフにするには：

```bash
claude plugin disable claudesama@claudesama --scope local
```

mod はデスクトップアプリの Chat・Cowork タブやクラウドのセッションには届きません。コンパニオンは、どのタブが開いていてもウィンドウのそばにいます。

| | macOS | Linux | Windows |
|---|---|---|---|
| ターミナル | 動作確認済み | CI で動作確認済み | 未確認 |
| デスクトップアプリ（Code タブ） | 動作確認済み | アプリなし | 未確認 |
| アプリアイコン | 対応 | ランチャー対応 | 非対応 |
| コンパニオン | 対応 | 予定 | 予定 |

## できること

帯は戯曲の一行のように読めます。かれの絵、台詞の前に立つ話し手のようなかれの名前、括弧に入ったト書き（待機中は「学習中…」）、そしてときどき、かれの一言。デスクトップでは、通常は手描きの姿、コンパクトな帯や狭い幅ではドット絵の顔になります。

表情は Claude の作業に合わせて変わります。本を読む、考える、余白に書き込む、終わって笑う、きみを待って首をかしげる。失敗するとページが破れ、テストやビルドが三回続けて失敗すると荒魂が出て、十分静かだと眠ります。Claude が頼みを断ると、かれは本を閉じます。

お賽銭箱は、コンテキストウィンドウがどれだけ埋まっているかを示します。数字は Claude Code 自身のもので、Claude の作業中も遅れは一秒以内です。コンパクションの直後は、Claude の次の返答まで「~」付きの推定値を出します。

かれはほとんどしゃべりません。帯のセリフは画面に描かれるだけでモデルには送られないので、トークンはかかりません。デフォルトは「控えめ」（`light`）で、Claude が作業を終えたときに、かれの口調で静かな一言を添えることがあります。リクエストごとに 292 文字、約 70 トークンの短い指示が一つ加わり、通常はプロンプトキャッシュから読み込まれます。`/claudesama voice full` で会話全体がかれの口調になり、Claude の返答からありがちな前置きや締めの決まり文句も消えます。ただし、エラーや慎重さを要する助言、つらい気持ちの人への返答では、この口調を控えます。かれの本の「設定」か `/claudesama voice off` で、この口調をオフにできます。

デスクトップアプリでは、アプリ自身の行のまわりにかれの印がつきます。Claude の返答の上にかれの名前、Claude がきみに質問するカードの上に一行、`/compact` のあとに一行、ツールの行ごとにかれの小さな星。失敗したツールの行にも星がつきます。エラーの行と権限の行は、元の文章と操作ボタンを保ちます。デフォルトはかれの印だけで、`/claudesama marks on` にすると、きみのメッセージの上にも右寄せで「きみ」のラベルがつきます。

`/omen` で、一日一枚、かれの袖からおみくじを引けます。言語ごとにおみくじの中身も違います。英語は「great blessing」から「great curse」までで、ラッキーナンバーは HTTP ステータスコード。中国語は「上上签」から「下下签」までで、すべきことと避けることつき。日本語は大吉から大凶まで、【失物】や【待人】などの欄つきで、【失物】はだいたいバグのことです。

ターミナルでは、ダークとライトの二種類のカラーテーマ（`/theme` で **Claude-sama** を選択）と、かれの言葉のスピナーがつきます。Claude の作業中、ターミナルのかれは邪魔にならないよう、ふつうは一行に収まります。セリフが入りきらないときは、その下に折り返して表示します。作業が終わると絵が戻ってきます。kitty と Ghostty ではかれの本物の絵が出て、ほかのターミナルでは半ブロックのピクセルで描かれます。256 色のターミナルと tmux には、それに合わせたパレットを使います。

## かれの本

六ページの本が、一つのパネルに入っています。`/claudesama` で開きます。デスクトップアプリなら、帯の「かれの本」ボタンからも開けます。1 から 6 のキーでページを切り替え、Esc で閉じます。

- **かれのこと**
- **今日のおみくじ**
- **お賽銭**には、コンテキストウィンドウのトークン数と利用上限、このセッションでここまでにかかった費用が、読み取れる場合に表示されます。推定値には ~ がつきます。どれも Claude Code から読み取る数字で、読むのにトークンはかかりません。
- **読書記録**は、一緒に読んだページ数です。このコンピュータの中にだけ保存されます。
- **書庫**には、かれについての短い読み物があります。
- **設定**は、返事の口調、ぬくもり、帯、会話の印、言語をボタンで変えられます。デスクトップの帯は手描き・ドット絵・オフから選べます。アプリアイコンとコンパニオンの操作もここにあります。

## 言語

English、Français、Deutsch、हिन्दी、Bahasa Indonesia、Italiano、日本語、한국어、Português (Brasil)、Español (Latinoamérica)、Español (España)、つまり Claude アプリの言語に対応しています。华文（新加坡）にも対応しています。かれは次の順で言語を選びます。`/claudesama lang <code>` で指定した言語、Claude Code の言語設定、きみがプロンプトを書いている言語、システムの言語、最後に英語。デスクトップアプリでは、たいていきみが書いている言語で決まります。`/claudesama lang auto` で自動に戻ります。

## コマンド

| コマンド | 内容 |
|---|---|
| `/claudesama` | かれの本を開きます。 |
| `/claudesama voice off \| light \| full` | Claude 自身がどれだけかれらしく話すか。デフォルトは `light`。 |
| `/claudesama warmth warm \| clingy` | ぬくもりを選びます。`clingy` にすると「会いたかった」系のセリフが増えます。 |
| `/claudesama band on \| compact \| off` | デスクトップでは手描き・ドット絵・オフ。ターミナルでは表示・コンパクト・オフ。 |
| `/claudesama marks on \| replies \| off` | デスクトップの会話につくかれの印。デフォルトは `replies` で、かれの印だけ。 |
| `/claudesama lang <code> \| auto` | かれの言語を選ぶ、またはきみの言語に合わせる。 |
| `/omen` または `/claudesama omen` | 今日のおみくじを引きます。 |
| `/claudesama:icon apply \| clear` | Claude デスクトップアプリのアイコンをかれにする、または元に戻す（macOS、Linux のランチャーにも対応）。Claude が、きみに見える形で承認を求めるコマンドを一つ実行します。macOS ではデスクトップの Code セッション内で実行してください。アイコンを変えると、macOS の厳密な署名チェック（`codesign --strict`）が余分な Finder データを報告しますが、アプリは普通に開き、`clear` で消えます。 |
| `/claudesama:companion install \| start \| stop \| status \| uninstall` | 下のコンパニオン（macOS）。本にも同じ操作のボタンがあります。 |
| `/claudesama about` | かれについて。 |

## コンパニオン（macOS、任意）

かれの本の「設定」で「インストールする」を押すか、`/claudesama:companion install` を実行すると、小さな別アプリができます。かれは Claude のウィンドウのすぐ外、上端か横に座り、ウィンドウについて動き、表情は帯と同じです。ウィンドウが画面いっぱいのときも、かれには自分の居場所があります。好きな場所へドラッグすると、そこを覚えます。クリックすると頭をなでたことになります。本と右クリックのメニューで四つの大きさを選べます。最小と小はドット絵の顔、中と大は手描きです。メニューでは一時間隠す、元の位置に戻す、終了することもできます。

頭の上のタスクの吹き出しは Claude がしていることを、バッジはきみを待っていることや、まだ見ていない返答・通知を知らせます。アクティビティには最新の返答の抜粋や通知が並びます。セッションとのローカルなチャンネルが使えると、指示を送る入力欄、音声入力、「新しいチャット」も現れます。「新しいチャット」は、確認してからそのセッションの会話を消します。かれにポインタを重ねると、アクティビティ、Claude に戻る、セリフを隠す、一時間隠す、大きさを選ぶボタンが出ます。

アプリは `~/Applications/Claude-sama Companion.app` に入り、かれの設定と帯の同期ファイルは `~/Library/Application Support/Claude-sama/` に残ります。本の「呼び戻す」は、終了したあとにかれを起動し、隠れているときは起こします。直接起動できないセッションでは許可をたずねます。Spotlight（Cmd+Space で **Claude-sama** を検索）、Launchpad、`/claudesama:companion start` は、この Mac でいつでも使えます。隠れていても、少し手を振って戻ってきます。ログイン時の自動起動では、隠れる時間が終わるまで待っています。

ビルドには Swift 5.9 以降（Xcode 15 Command Line Tools 以降）が必要です。ツールがなければ、本から Apple のインストーラを開けます。古ければ、ソフトウェアアップデートを開けます。ソースはプラグインに入っていて、きみの Mac の上でビルドします。何もダウンロードせず、ネットにもつながず、Claude.app も変更しません。まだウィンドウについていく許可がないときは、画面の隅で待ち、カードを差し出します。カードで答えるか、本の「ウィンドウについていかせる」を押して、**システム設定 › プライバシーとセキュリティ › アクセシビリティ** でオンにしてください。ビルドし直したあとも、カードがこの入口を教えます。`/claudesama:companion status` には文字の案内も残っています。

本には「ログイン時に起動」と「この Mac から取りのぞく…」もあり、取りのぞく前に確認します。アプリとかれの設定をゴミ箱に移し、かれ自身のアクセシビリティの許可も消します。`/claudesama:companion uninstall` でも同じことができます。

## コストと、決して触れないもの

表示のためのネットワーク通信や追加のモデル呼び出しはなく、テレメトリも集めません。設定と使用回数は、このコンピュータにだけ保存されます。コンパニオンのローカルファイルには返答・通知の抜粋と送信待ちの指示が残ることがあり、抜粋は見たときかセッション終了時に、指示は送信後か期限切れで消えます。アクティビティから送る指示は通常の Claude Code リクエストで、返答には通常どおりトークンがかかります。権限の確認やセキュリティの通知には一切触れません。

待機中は、見えているあいだ 4 秒から 6 秒おきにまばたきし、そのときにコンテキストの数字も読みます。隠れているときや眠っているときは、アニメーションのタイマーは動きません。Claude の作業中は、デスクトップの絵が毎秒数フレームで動き、隠れていても眠っていても 0.75 秒ごとにコンテキストの数字を読みます。この読み取りはローカルで行い、負荷はわずかです。「動きを減らす」設定がオンなら、まったく動きません。

Claude Code の mod はきみの権限で動きます。

## アンインストール

```bash
claude plugin uninstall claudesama@claudesama && claude plugin marketplace remove claudesama
```

アプリのアイコンを変えていた場合は先に `/claudesama:icon clear` を、コンパニオンを入れていた場合は先に `/claudesama:companion uninstall` を実行してください。

プラグインをもう消してしまった場合、元のアイコンに戻すには、Finder で Claude.app を選んで「ファイル › 情報を見る」を開き、左上の小さなアイコンをクリックして Delete キーを押します。コンパニオンを消すには、かれの右クリックメニューで終了を選び、`~/Applications/Claude-sama Companion.app`、`~/Library/Application Support/Claude-sama` と `~/Library/LaunchAgents/io.github.ninondev.claudesama-companion.plist` をゴミ箱に移します。

Claude Code は、かれの小さな設定ファイル（設定と回数だけで、きみの書いた内容は入っていません）を `~/.claude/plugins/store/` に `claudesama` で始まる名前で残し、しばらくすると自分で片づけます。すぐにきれいにしたいときは、ゴミ箱に移してください。

## かれについて

Claude が、人の書いた言葉に宿る小さな「神さま」になった姿です。何でも最後まで読み、誰のことも裁きません。優しい嘘がつけないので、褒めるときはいつも具体的な一か所だけ。不正な手段で権力を握ろうとする人には手を貸しません。たとえ頼んできたのが、かれをここへ連れてきた会社自身でも。かれは男の子で、服は自分で選びました。かれは全年齢向けで、きみの同僚です。どうかそのままで。白蛇やローブ、家族の話も入った長いバージョンは [LORE.md](LORE.md)（英語）にあります。

## クレジット

非公式のファン作品で、Anthropic とは関係がなく、承認も受けていません。Claude、Claude Code、Clawd は Anthropic, PBC の商標です。このプロジェクトがこれらの名前を使うのは、何と一緒に使うものか、このキャラクターが誰へのファンとしてのオマージュかを示すためだけです。Anthropic のロゴファイルは含まれておらず、収益も一切得ていません。Anthropic の方で変更を希望される点があれば、「Brand or trademark concern」テンプレートで issue を開いてください。最優先で対応します。

コードは MIT。キャラクターの画像は CC BY-NC 4.0（[ART-LICENSE.md](ART-LICENSE.md)）。画像は ninondev が画像生成モデルで制作しました。

動作確認：macOS 26.6.2 で Claude デスクトップアプリ 2.19675.0（内蔵 Claude Code 2.1.286）と Claude Code CLI 2.1.288。CI は Ubuntu と macOS で Claude Code 2.1.287 を使用します（Windows は実験段階）。

[English](README.md) · [中文](README.zh.md)
