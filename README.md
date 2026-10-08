# Tabview Bilibili

需搭配[Bilibili-Evolved](https://github.com/the1812/Bilibili-Evolved)食用：[Bilibili-Evolved播放页设置](./images/Bilibili-Evolved视频页设置.png)

把 B 站视频页的**简介、评论、推荐视频**收进右侧标签页，无需下划页面，专注看视频。思路来自 Tabview YouTube 的 B 站版。

油猴脚本（Tampermonkey）· 支持 Chrome / Edge / Firefox

## 功能

- 🗂 **右侧标签页**：视频、简介、评论、推荐四个标签自由切换，看视频不用下翻
- 🔍 **零侵入架构**：不改 B 站 DOM 结构（不移动节点、不写 inline style），只切 class + CSS 变量，与 B 站前端（Vue/hydration）和平共处
- 📝 **评论优化**：评论框默认折叠、楼中楼排版修正、评论字号可调（0.8x–1.6x）
- 🔄 **评论续载**：修复"页面不滚导致评论加载不出下一页"的问题
- ⬆️ **智能回顶**：快捷键回到顶部 / 回到评论首楼
- 📦 **合集收起**：可折叠右侧合集列表
- ⚙️ **高度可定制**：标签页位置 / 宽高 / 上下边距微调，设置自动保存
- 🚀 **性能友好**：评论区变更检测（树没变不重算），静止状态接近零开销

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展
2. 安装本脚本：从 Greasy Fork 安装（或下载 `Tabview Bilibili.user.js` 后拖入浏览器）
3. 打开任意 B 站视频页，右侧出现标签栏即成功

## 快捷键

| 按键 | 功能 |
|---|---|
| `1` `2` `3` `4` | 切换 视频 / 简介 / 评论 / 推荐 标签 |
| `+` / `-` | 标签页高度加减 |
| `↑` | 回到顶部（评论页时先切到评论再回顶） |
| `V` | 评论字号 0.8x–1.6x 循环 |
| `W` | 平滑回顶 |
| `X` | 设置默认标签页（记住上次 / 指定） |
| `Y` | 折叠 / 展开合集 |

## 说明

- 仅在 `https://www.bilibili.com/video/*` 页面生效
- 停用脚本（Tampermonkey 开关）后完全还原，不留任何残留

## 许可

[MIT](LICENSE)
