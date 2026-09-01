# 条码工作台

面向专业用户的浏览器条码工具，支持快速粘贴编号、Excel 批量导入以及 PNG、SVG 下载。

[在线使用](https://play.wangyifang.com/barcode/)

## 功能

- 一行一个编号，自动生成 CODE128 条码并预览最新一条。
- 支持单条 PNG、SVG 下载和多条 PNG 连续下载。
- 支持 `.xls`、`.xlsx` 文件导入、工作表选择、表头识别、编号列映射和数据预览。
- 条码宽高、文字、颜色和下载行为保存在浏览器本地。
- 支持亮色、暗色和跟随系统主题。
- 支持 iOS、Android 和桌面浏览器安装为 PWA，并可离线使用。
- 提供 Windows 10 及以上系统的单文件绿色版，无需安装即可离线运行。

## 使用

需要 Node.js 20.19 及以上的 20.x 版本，或 Node.js 22.12 及以上版本。

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

构建产物位于 `dist/`，资源路径固定为 `/barcode/`。

Windows 10 及以上系统可从顶部栏下载绿色版，也可以直接前往
[GitHub Releases](https://github.com/wyfang/barcode/releases/latest/download/barcode-windows-x64.exe)。
绿色版由 GitHub Actions 在 Windows 环境编译，不写入安装目录；当前未进行代码签名，
首次运行时 Windows 可能显示 SmartScreen 提示。

本地调试桌面版：

```bash
npm run desktop
```

Windows 绿色版构建：

```bash
npm run package:win
```

## 数据与部署

条码内容和 Excel 文件均在浏览器本地处理，不会上传服务器。浏览器设置保存在本地存储中，最近下载状态保存在当前会话中。

本仓库维护应用源码；`play.wangyifang.com` 的 Cloudflare Workers 仓库只保存同步后的静态构建产物和部署配置。

## 版权说明

本仓库当前未声明开源许可证。公开可见不代表获得复制、修改或再分发授权。React、HeroUI、JsBarcode、SheetJS 等第三方依赖分别遵循其自身许可证。
