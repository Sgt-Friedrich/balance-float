# Balance Float

Windows 右上角半透明余额悬浮窗，支持 DeepSeek 和 Vultr。

## 功能

- 右上角置顶半透明悬浮窗，可拖动，可隐藏到系统托盘。
- 托盘图标单击显示/隐藏，右键支持显示、刷新、隐藏、退出。
- 设置中填写 DeepSeek / Vultr API Key、刷新间隔、透明度、开机自启、启动隐藏。
- API Key 使用 Electron `safeStorage` 加密保存；不可用时会降级为本机明文配置。
- DeepSeek 读取 `/user/balance`，Vultr 读取 `/v2/account`。

## 使用

直接运行：

```powershell
.\release\"Balance Float 1.0.0.exe"
```

开发运行：

```powershell
npm.cmd start
```

重新打包：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm.cmd run pack
```

输出文件在 `release/Balance Float 1.0.0.exe`。
