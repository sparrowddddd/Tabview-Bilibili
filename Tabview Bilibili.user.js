// ==UserScript==
// @name         Tabview Bilibili（哔哩哔哩右侧标签页）
// @namespace    https://www.bilibili.com/
// @version      4.2.2
// @description  把视频简介、评论、推荐视频收进右侧标签页，无需下翻页面，专注看视频（Tabview YouTube 思路的 B 站版）
// @author       WorkBuddy
// @license      MIT
// @match        https://www.bilibili.com/video/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

/*
 * ================= v3.0 架构（实测驱动） =================
 *
 * 历史教训：
 *  v1.x 移动 B 站节点到自建面板 → Vue prepatch 崩溃（评论区空白、UP 头像消失）
 *  v2.0/2.1 把 tabs 插进 .right-container-inner 并给 B 站节点写 inline style
 *        → 在 Vue hydration 窗口期（页面加载后 ~5s）破坏 SSR 水合匹配，
 *          引发连锁错误：videoInfo 测量崩溃、"Player.disconnect"、
 *          header 二次挂载 + nextSibling 崩溃
 *  v2.2.x 定下"零 DOM 移动 + 视觉传送"，错误清零
 *
 * v2.2 三原则（对 Vue 零侵入）：
 *  1. 自建标签 UI 挂在 document.body（Vue 不管理的区域），自身 position:fixed
 *  2. 对 B 站节点只做两件事：切换一个自定义 class + 全部几何参数走
 *     <html> 上的 CSS 变量（不写 inline style，不改 DOM 结构，不移动节点）
 *  3. 等 B 站应用启动完成（hydration 结束，播放器就绪）后才做任何 DOM 写入
 *
 * v4.2 新增：齿轮弹层里加"打赏"入口 ——
 *   Z. 齿轮下拉最下面多一条加粗绿色的「打赏」，点击弹出全屏浮层显示收款二维码。
 *      浮层点遮罩、点「关闭」、按 Esc 都能关；停用时整个浮层从文档移除
 *      （不会残留遮罩挡住页面）。
 *
 * v4.2.2 性能优化（本次）：标签页出现更快 + 常驻开销更低 ——
 *   · 启动地板 3500ms → 1000ms、轮询 250ms → 100ms：siteBooted() 本就判播放器
 *     就绪，过早误启由 1s tick 自愈 + 启用后 600ms 补测纠正。效果上标签 UI
 *     从"最快 3.5s 出现"提前到 ~1.1s。
 *   · CSS 提前到 document-start 注入（规则全部有 html.btv-on gate，未启用无
 *     副作用），启用瞬间不再等样式解析。
 *   · 评论区脏标记：原来每秒无条件做一次 ≤2 万节点的 shadow BFS（deepCollect），
 *     现在挂 MutationObserver（#commentapp + BFS 发现的各 shadowRoot），树没变
 *     就跳过，30 tick 兜底一次。最坏与原来持平，静止页面接近零开销。
 *
 * v4.2.1 调整：把用户的真实收款码内置进脚本 ——
 *   · REWARD_QR 填入压缩后的 data URI（原图 1080×1315 / 117KB →
 *     裁掉绿底标语与底部"微信支付"横条、只留二维码 + 昵称，508×570 / 13KB）。
 *     之所以要裁：浮层里图片按 min(78vw, 300px) 展示，整张图缩到 300px 时
 *     二维码只占 ~110px，太密容易扫不动；裁完二维码能占满 ~240px。
 *   · 二维码来源改为「本地覆盖优先」：localStorage('btv-reward-qr')（用户在浮层里
 *     「换一张」导入的图）> REWARD_QR（内置）> 空（显示拖放导入区）。
 *     这样用户以后换收款码不用等改脚本，自己换一张即可；浮层里也留了
 *     「恢复内置」把本地覆盖清掉。
 *   · 展示尺寸 260px → 300px，并把二维码放大到接近浮层宽度上限。
 *
 * v4.1.1 调整：V/W 两个工具按钮从"评论头部内部"移到"标签条的「评论」
 *   标签两侧"（用户要求：箭头所指处，即「评论」按钮的左右两边）——
 *   左侧 = 字号 +/− 竖排小按钮组（#btv-cmt-fs，+ 在上 − 在下，36px 高与标签同高）；
 *   右侧 = 回顶 ↑（#btv-cmt-top，36×30px）。
 *   这样做同时解决三件事：
 *     · 视觉归属更清楚 —— 工具本来就只服务评论面板，贴在「评论」标签上不需要解释；
 *     · 不再依赖 B 站组件的 shadow DOM —— 原先插在 bili-comments-header-renderer
 *       的 #navbar 里，组件重建（换视频/风控重渲染/SPA 跳转）就得靠自检+重建归位
 *       兜底，现在挂在我们自己的 #btv-tab-header（Vue 零感知区），随标签 UI 一起
 *       创建、隐藏、卸载，零维护成本；
 *     · 顺带解决"评论头部横向空间紧张"——原先 +/− 与 ↑ 挤在「评论」标题两侧，
 *       给标题行增加了 100+px 的固定占用。
 *   行为补强：在别的标签页点 ↑ 会先切到「评论」再回顶（隐藏态下 #commentapp 是
 *   0 尺寸盒，只滚它没有任何可见效果）；字号到边界（80%/160%）时按钮半透明表示
 *   按不动了，点击瞬间会把当前百分比短暂显示在 + 按钮上（900ms 后复原）。
 *   v4.1.0 注入到评论头部 shadow 里的旧节点由 dropLegacyCmtTools 清理（热更新兜底）。
 *
 * v4.1 新增：四个小功能 ——
 *   V. 评论区字号调节：+ / − 两个小按钮（+ 在上、− 在下，位置见 v4.1.1）。
 *      改的是 html 上的 --btv-cfs 倍率（0.8~1.6、步进
 *      0.1、默认 1=与原生一致），四处落点（实测口径，v41 系列探针）：
 *        · 面板级：#commentapp 的 font-size = calc(12px * var(--btv-cfs))——
 *          "继承字号"的文本自动跟随；
 *        · 正文级：bili-rich-text 的正文（16px/26px）是组件自己 shadow 里的显式
 *          字号，靠继承打不进去 → 往它自己的 shadowRoot 注入
 *          :host{font-size:calc(16px*var(--btv-cfs))} +
 *          #contents{font-size:inherit;line-height:1.6} +
 *          #contents *{font-size:inherit;line-height:inherit}（实测 span 16→22.4px、
 *          渲染宽 96→134px，是真变大，不只是计算值变）；
 *        · 用户名级：bili-comment-user-info 的 #user-name 也是显式字号
 *          （14px/21px，不吃面板继承）→ 往 user-info 的 shadowRoot 注入
 *          #user-name, #user-name a { font-size: calc(14px*var(--btv-cfs)) }；
 *        · 时间节点：#pubdate 原生写死 12px，换成同一个 calc。
 *      倍率落 localStorage('btv-cfs')，重载自动恢复；停用时清除 --btv-cfs 并
 *      移除注入的 shadow 样式，calc 回落原生值。
 *   W. 一键回到评论顶部：一个向上箭头按钮（位置见 v4.1.1），点击把 #commentapp
 *      平滑滚回顶部（另一标签页下会先切到「评论」）。
 *   X. 默认展示的 tab：标签栏右端加一个齿轮入口，浮层可选
 *      「跟随上次使用 / 简介 / 评论 / 视频」；存 localStorage('btv-default-tab')，
 *      启用时优先按它激活，未设置则沿用原来的"记住上次"。
 *   Y. 合集（多P/合集视频）列表收起/展开：合集标题右边（.video-pod__header >
 *      .header-top > .left 里、标题与「（1/158）」之后）加「收起 / 展开」小按钮，
 *      收起 = 给 .video-pod__body 打 display:none —— 实测 .video-pod 由 349px
 *      缩到 99px、推荐列表顶边由 y=483 提到 y=233，推荐视频一眼可见。默认展开。
 *      注意 B 站原生 .pod-expand-btn 只切 body 的 max-height（250↔778），
 *      与我们的 display 开关互不干扰。
 *
 * v4.0 调整：评论区滚到底加载不出更多评论 ——
 *   U. 根因在 B 站 bili-comments 的续载挂载点（bundle 逆向确认）：
 *      addLoadEvent() 在首屏渲染前调用（.trigger 哨兵还不存在），走的是兜底
 *      分支——监听 (scrollContainer || window) 的 scroll；scrollContainer 只在
 *      「组件连接那一刻 #commentapp 已是 overflow-y:auto/scroll」时才非空。
 *      我们的版式里 bili-comments 连接早于切到评论 tab（那时 #commentapp 还是
 *      隐藏盒，没有 overflow-y）→ scrollContainer=null（实测确认）→ 监听落到
 *      window —— 而我们的页面文档不滚（评论自己在 #commentapp 里滚），
 *      于是「滚到底自动加载下一页」永远不会触发（getList 无人调用）。
 *      修法：复刻 B 站兜底分支到自己身上——在 #commentapp 挂节流滚动监听，
 *      「scrollTop + 2×clientH ≥ scrollH」时调用组件自己的 getList()
 *      （组件内部有 showEnd/showSpinner/showContinuations 三重守卫，幂等安全）。
 *
 * v3.9.1 调整：标签页右缘被经典滚动条盖住（最右「视频」标签圆角消失）——
 *   T. v3.8 O 用 window.innerWidth 贴右缘，而 innerWidth **包含**经典滚动条占的
 *      约 15px，clientWidth 才是真正的内容区宽。实测（强制 html{overflow-y:scroll}
 *      复现 15px 滚动条）：最右标签 btn.right=1920 > clientWidth=1905，最后 15px
 *      连右圆角一起落在滚动条底下，elementFromPoint 在该处返回 null（点都点不到）。
 *      修法：右缘按「max(实际滚动条宽, 15) + 8px」让位 —— 经典滚动条用
 *      innerWidth - clientWidth 算出它的实际宽度；遮罩式滚动条差值为 0 但同样
 *      浮在内容最右 ~15px 上，所以下限取 15。两种情况下最右标签圆角都留 8px
 *      净空。高度同时改用 clientHeight（顺带避开横向滚动条）。
 *
 * v3.9.0 调整：切 tab 往返后一级评论时间掉行 + 底部灰底——
 *   R. 切到别的 tab 再切回「评论」，一级评论的时间跑到正文下面：原因是面板
 *      隐藏时 #commentapp 是 0×0 隐藏盒（fixed + left:-99999px + 宽高 0），
 *      但 1s tick 仍在跑，而卡片改造是"测量驱动"的 —— 内部元素 rect 全失真
 *      （实测名字被压到 49px、正文宽 0），于是判定"时间摆不到名字旁边"，
 *      还原时间到原位并打上 data-btv-act='skip' 永久跳过。修法：面板自身
 *      rect 宽高任一 ≤1px 时直接跳过卡片级测量（只保留不依赖测量的幂等改动）；
 *      同时给 skip 卡片加每 30 tick 的复检窗口（组件重建/历史误标可自愈）。
 *   S. 视口底部露出灰色（#f1f2f3）：隐藏右栏弹幕列表后主容器高度（947）不足
 *      视口（1080），底部约 69px 露出 body 灰底。把 body 背景统一成 var(--bg1)
 *      （浅色=白、暗色主题自动跟随），只动背景色、不改盒模型。
 *
 * v3.8.0 调整：贴边布局 + 评论区留白/对齐四项——
 *   N. 整页贴边：B 站主容器（#mirror-vdcon）把左右两栏整体居中，导致左栏
 *      （播放器/UP 信息带）离左边、右栏标签页离右边各有一段空白。改为
 *      justify-content:flex-start + 左内边距 24px（= 顶栏 bilibili logo
 *      「B」字的左缘），宽度改 border-box:100% 抵消内边距增量（防横向滚动条）。
 *   O. 标签页右缘贴到视口右缘：tabAreaBox 的宽度从「右栏原生宽」改为
 *      「视口宽 - 右栏左缘」，中间不留死区；UP 面板仍用右栏原生宽
 *      （nativeW），左栏信息带比例不变。
 *   P. 评论头像左缘对齐卡片左缘：原生 #user-avatar 是 absolute left:20px
 *      （悬在正文列缩进里），改 0 后头像正对「评论」标题的「评」字；
 *      楼中楼同理对齐各自卡片。inline left 对 position 非 absolute 的
 *      头像（如评论框里的）是空操作，误伤面为零。
 *   Q. 「最热|最新」行到第一条评论之间留白收紧：navbar 底距 22→4px、
 *      列表 padding-top 14→0px、卡片自身 padding-top 22→12px
 *      （首条评论上方空白 58px → 约 26px）。内联样式每 tick 幂等重打，
 *      resetHeaderBoxUI 统一还原。
 *
 * v3.7.1 调整：
 *  M2. 「发表评论」入口按钮改为与「最热|最新」同款文字按钮样式，且直接
 *     插在「最新」右边（带同款 | 分隔符），不再贴行尾：字号/颜色/高度完全
 *     复用 B 站 sort-actions 的规范（13px、--text3/--text1、28px 高、6px 边距，
 *     分隔符 = 11px 高、margin 0 3px、border-left 1px --text3）。展开态文字
 *     「收起」用选中色 --text1，收起态「发表评论」用普通色 --text3。仅当排序
 *     区存在时插在它后面；无排序区（单模式/风控）则回落到贴行尾方案。
 *
 * v3.7 新增（本次）：
 *  M. 自己的评论框默认收起，改为「最热|最新」排序栏右侧一个入口按钮：
 *     B 站原生把"发表评论"框常驻评论列表顶部，占一整块高度。现在默认折叠
 *     （给 shadow 内 #commentbox 内联 height:0 + overflow:hidden，B 站自带
 *     transition:height .2s → 天然折叠动画），在 #navbar（标题+最热|最新所在
 *     的 flex 行）最右插入一个"发表评论"胶囊按钮（若 B 站有 ⋮ 菜单 #more 则
 *     插到它左边，并把 #more 的原生 margin-left:auto 改为 12px，避免两个
 *     auto margin 平分空隙导致按钮悬在中间）。点击展开（高度动画到位后摘掉
 *     内联 height，textarea 自增高不受限）并自动聚焦输入框；按钮变"收起"，
 *     再点即折叠。组件重建（换视频/风控重渲染）时按实例复位为默认收起；
 *     停用脚本时按钮移除、#commentbox 与 #more 的内联样式全部还原。
 *
 * v3.6 修复：
 *  L. 评论框"消失/跑到左下角与 UP 面板重叠"：
 *     B 站评论组件（bili-comments-header-renderer）在认为评论框被滚出视口时，会把
 *     评论框搬进一个 position:fixed 的 .bili-comments-bottom-fixed-wrapper，
 *     left/bottom 全用**视口坐标**（scrollContainer 为 null 时）—— 而我们的
 *     #commentapp 本身就是 fixed 的标签面板，页面文档根本不滚动：
 *       ① wrapper 锚到视口左下角 → 与传送过来的 UP 信息面板重叠；
 *       ② 回滚监听挂在 window.scroll 上，我们的页面不滚 → 滚回顶部也永远不还原。
 *     修法：给 header-renderer 实例打补丁 —— teleportCommentbox(false)（搬走）
 *     直接不执行，评论框留在评论列表顶部（滚下去时随列表滚出视野，滚回来就在，
 *     与原生无浮层版式一致）；teleportCommentbox(true)（还原）保持原语义。
 *     若补丁前已被搬走（revertTeleportCommentbox 存在）立即调用还原；
 *     再兜底：每秒自愈 tick 里发现漏网的 wrapper 就把它内联重锚到评论面板
 *     底部（left/width 走 --btv-l/--btv-w，bottom 走 --btv-ab），保证任何
 *     情况都不压 UP 面板。脚本停用时（enabled=false）补丁自动透传原方法。
 *
 * v3.5 修复：
 *  K. 楼中楼的**回复正文紧贴在时间后面**，没有另起一行：
 *     v3.4 把时间摆到名字右侧后，紧凑排版里"用户名 / 时间 / 正文"同在一个容器
 *     按行内流排列，正文就顺势粘在时间后面（前缀短时尤其明显）。
 *     修法：正文（bili-rich-text）强制成"整行盒"—— 普通容器里改 display:block
 *     （块级盒在行内流里必然另起一行），flex/grid 容器里让容器允许换行并让正文
 *     占满一整行；若名字有左缩进（容器里还有头像）就补同样的左缩进保持对齐。
 *     改完实测"正文顶边是否落到名字行底部之下 + 时间是否仍在名字右侧"，不达标
 *     只撤销这一步（保留时间已摆好的结果，不整卡回滚）。标记 `data-btv-body`。
 *
 * v3.4 修复：
 *  J. 楼中楼里时间仍显示在名字"下面"而不是紧贴名字右侧：
 *     v3.3 只保证"不搞乱排版"，但把时间节点搬进名字行容器后**没有校验它落在
 *     哪一行**。楼中楼是紧凑排版，user-info 常常是块级元素、或名字行容器是
 *     "列方向 flex" —— 这两种情况下内联时间都会另起一行落到名字下面。
 *     改为"测量驱动"：搬进去后实测时间矩形 vs 名字文本矩形，不同行就依次换
 *     策略（A 行内化 user-info、B 名字行改 flex-wrap 让名字+时间独占第一行、
 *     其余子元素各占整行），仍不行则整体还原 + 永久跳过该卡片。
 *     卡片上留 `data-btv-cmt` 标记（plain/info-inline/flex-rows/skip）便于排查。
 *
 * v3.3 修复：
 *  I. 楼中楼回复排版被搞乱（正文被挤成"一个字一行"贴在右侧）：
 *     v3.2 用 `[id=header]/[class*=header]` 模糊查找"名字行"，而楼中楼是紧凑
 *     排版，这个容器往往同时装着用户名和正文 —— 给它设 display:flex 后，正文
 *     作为 flex 项被压到最小宽度（中文逐字换行）。改为：名字行 = 前面最近那个
 *     用户名节点的**直接父容器**（最小容器）；若该容器里还装着正文/操作行，
 *     则完全不碰 display，只让时间以 inline-block 紧跟用户名。
 *     另加布局自检：若正文仍被压到窄于 24px，撤销该卡片的全部改动并跳过。
 *
 * v3.2 修复：
 *  G. 左下角 UP 主信息面板"看得见却点不动"（进主页/关注/充电/发消息全部失灵）：
 *     右栏 .right-container-inner 是 position:sticky，自带层叠上下文，
 *     被传送到左栏的 .up-panel-container 的 z-index 只在这个上下文内部生效，
 *     而左栏 .left-container 是 position:sticky + z-index:1 → 左栏整体压在
 *     面板之上，命中测试全落在左栏盒子上。修法：抬升右栏层叠层级。
 *  H. 评论区时间未搬到用户名之后：原实现假设"用户名在 [id=header] 里、
 *     时间在操作行 shadowRoot 的第一个子节点"，对不同版式/登录态的嵌套层数
 *     不够健壮；且向 shadowRoot 注入 <style> 的方式也可能被组件重建冲掉。
 *     改为：深度遍历所有 shadowRoot + 内联样式（对 shadow 内部元素 100% 生效）。
 *
 * v3.1 细节调整：
 *  D. 标签页顶边改为对齐"播放窗口顶边"（原先锚在右栏顶边，而部分版式里
 *     左栏比右栏低几像素，导致标签头比播放器高出一截）
 *  E. 收紧左栏信息带的上下留白：#viewbox_report 的固定尾部留白折叠、
 *     顶部内边距由 22px 降到 8px、三连栏上下内边距 16/12 → 10/10；
 *     UP 信息面板由"垂直居中"改为"与标题同高对齐"，消除播放器与 UP 信息、
 *     标题与三连栏之间的两处空白
 *  F. 评论区（shadow DOM 内）外观：时间从操作行搬到用户名之后，
 *     点赞/踩/回复/更多 靠右对齐
 *
 * v3.0 版式调整：
 *  A. 右栏"弹幕列表"整块（.video-pod-above-modules，含广告位）删除
 *  B. 右栏 UP 主信息（.up-panel-container）视觉传送到左栏信息带左侧，
 *     标题 / 播放量 / 三连栏整体右移让位 → 标题等信息位于 UP 信息右侧
 *     （正是原来"标题右侧那一大块空白"的位置）
 *  C. 右栏从此空无一物 → 整个右侧区域就是标签页（从顶到底铺满）
 *
 * 两种站点版式都要兼容（B 站存在 A/B 版式）：
 *  - "标题在播放器下方"（经典版式）：信息带 = [标题块顶, 三连栏底]
 *  - "标题在播放器上方"（新版式）：信息带 = 标题块自身（三连栏在播放器下方，同样右移对齐）
 *  运行期用 getBoundingClientRect 判断，不硬编码
 *
 * v2.2.4 修复的两个隐蔽坑（均有实测证据）：
 *  1. siteBooted() 里 $ 的参数顺序写反（$ 签名是 (sel, root)）→ 每次调用必抛
 *     "querySelector is not a function"，启动检测与自愈循环全废，UI 永不挂载
 *  2. pointer-events 双重陷阱：.right-container 本身是 pointer-events:none，
 *     故被传送的 .rcmd-tab / #commentapp 必须显式 auto，否则滚轮与点击全部落空；
 *     且仅给子容器 #btv-tab-content 设 none 无效——命中测试会落在父容器
 *     #btv-right-tabs 自己的盒子上，必须整体 none + 标签头单独 auto
 */

(function () {
  'use strict';

  const STORE_KEY = 'btv-active-tab';
  const DEF_TAB_KEY = 'btv-default-tab';   // v4.1 X：默认展示的标签（'last' | 'info' | 'comments' | 'videos'）
  const CFS_KEY = 'btv-cfs';               // v4.1 V：评论字号倍率（0.8 ~ 1.6，步进 0.1）
  const POD_KEY = 'btv-pod-collapsed';      // v4.1 Y：合集列表收起态记忆（'1' = 收起）
  const REWARD_KEY = 'btv-reward-qr';       // v4.2 Z：打赏二维码（浮层里导入后存这里）
  // v4.2.1 打赏二维码（内置，随脚本分发、开箱即用）。
  // 原图 D:\Download\mm_facetoface_collect_qrcode_1790590687370.png（1080×1315, 117KB）
  // 已裁成"二维码本体 + 昵称"（508×570），量化到 48 色 PNG（13KB）——
  // 整张图缩到 300px 宽时二维码只有 ~110px 太密，裁完能占满 ~240px，实测可扫。
  // 结构：REWARD_QR 为内置码（兜底），localStorage[REWARD_KEY] 为本机覆盖（优先）。
  const REWARD_QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAfwAAAI6CAMAAAD11QoVAAAAkFBMVEX///////35//z5+fb2797379'
    + '32793279z179317t307Nvt7ezs7Ozs7Ory69vv49Dj4dHU0cjNzczPxrO4uK+zrp6urq6urpsaxG2koJaPkYePj4+Zf3KAfnaWZV'
    + 'xwcHBwcGhwaV9rbGljYFlyVExRUVFRT0lJSUg2NjYyMjIxMTElJSUZGRkTExMREREAAADDWfH7AAAytklEQVR42u1dC3uquhLV0r'
    + 'NbxQcv8QJSVOqjD+3//3d3JiEBG6FBsWKd5dezj4CILFYmmcxMOh0CgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBA'
    + 'KBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCIQ/ja/z8FZxRlPZtTrzjCp85eBI7FopuwbyYx'
    + 'U3RF5jdNp9lL/6/cxbe9vkD9pGvvkb5Mtf/XbX5JPySfl3Rj4pn5RPyiebT8on5ZPyyeaT8kn57SPfGgzMge5fUEGVPK5bh/yNOL'
    + 'ez2+92h38Vd0geI6kyxPf7ynk+5PXLbeoDaopjEuXzqXqw3CfvTVdRfqB/XwcD6yrkm3U+5VeQr6MqFVKnzmk6icqvMX9Sav3qpP'
    + 'watdqS9/LWqQKDq5A/+Pvk72r96nPJf7sh8kn5pHxS/nWVb5LySfmk/NYr3ySbT8on5ZPNv32bn769l72icvJNeVTFl1lOKawK8u'
    + 'VBqrsnEruG6m0Uu/KnQF5jxa/2xJahco2BOCY9TflR+Z1NW6L8Cp90Uk5+YxftVDg6dxruXa0zVvxqv057V0/5iYZT+8o2//2eyD'
    + 'cvR/77DZF/pvJNUn4jyjdJ+b+v/HdSfstt/r5tyjfJ5pPyyeaTzSebT8q/O+UbvoA8dbrKIB04odgiPSm+2BJWUCWOWfkKklUp5B'
    + 'lNcXCQPzMC8mjZndiWn3FbQZU8yLxDm38EUqdOeXxcVMu9a57kMK5yxu7Oi1wc1GpL/qzyj2DfOPmD88g3dcYP55I/uEObT8on5V'
    + '+W/EHbyDcbVz7ZfFI+2Xyy+aR8Uj7Z/Dba/AHZfObkSQTkqSMBGWXjiS3ycXDEFl8hfy8/r15jJL7so/xiP8QxeSaXPKO8WPVjqT'
    + 'hGunS2Yksq48HEx5ek/Mv49ndNZcCemPqZlP/qr9NmC8i3r03+vqkM2N8l36T5fFI+zeeT8snmk/LJ5pPyyeaT8snmk/JbqPzcA6'
    + 'LA17H50pNilH+r9PaoCOW3qS4ZueVTfNmm/GI34phP9UvUo3eKkydWfrWTaMAoV75f/qnopvPzBzqe+M6ZGqgVw+fXqnT1rpH6WQ'
    + '93lKU70PHEn0v+/nLkvzVO/h3l55Py71j55m8of/f3lU82n5R/7zbfvEvlk83/E80+2Xyy+Tdh8wO/BmKdxCV5tGwCHPl5cYyUx6'
    + 'fYkqqpVBXJVb5yakchfy8+tVFvrCc+JnPLPhXyLeXUMgHMyx81AUNRflznzga3WHK9SqenxfBp+fZ1nLHXvsavP19vv/kbq+Xbvz'
    + 'L5e1pp46eY+LYo/0rXSMon5RP5ZPOJfFI+2Xyy+aR8Uv6VyH87D2leeFlA1ineii22ZEhsCcUxodiSVKhKnrqi3k0kjlGLQ3/IK5'
    + 'InkqfelF+jX0v56jWmZ97azi2ilm8/6WjE8J3mN6+qt18LWson1K9ln+hE757mN6+qt98U+Tuim5RPIOUTSPlEPimflE/KJ+WT8l'
    + 'sNc5C9HpRdhthnKFukurtyy36XveQ+U/l8LI5JBua3lyM+/yG/XznGlMoP1H3iFRTWWc/OaA5+fqm/MRKfT1XlV5zpIV/U/efvMK'
    + '9Lvuro7JzpN9fRaXRmWuW59TJrJWp2aq3955RXDEvOXJ+wbeSfuLbkr5I/IPI7uvUyGyP/jcgn5RP5f5R8svmkfFI+kU82n8gn5Z'
    + 'PNJ5vfUvJ1fkZFNFtHR1VOp0bqZ71otpVGWmWVJ75WyfVVU+RrVQwj8hslf0fkk/KJ/IbJN29T+Xsin5RP5JPNJ/JJ+UQ+2Xwin5'
    + 'R/B+Rb5oCjECLFUIg6yv1xO4hqQmwqyLfE59XAsFh8Xv4rJfgursOqIH8jPufj+RGJOF+sHPwgrsOS36eS72XnGWyU37EUnzcPzm'
    + 'geXKN6Hx/yALns8+pCbJvsPFcK49LJgNVxxv5KHb5OnSzdTq1FFXWcsR2d9q7Wr151WhZre5on/lfq8HXq5Od3aq2l2xj5g1skn5'
    + 'RPyj9V+YMbUH7z5JukfFI+2Xyy+aR8Uj7Z/EvU22+dzb9x5ctiRdInYYst+Wr1b+/8la9oJo7x38U+9Ta8y33iJYtUD8XnE53HSX'
    + '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'
    + '7s5C/bD8Tvl7/REr//Pb+h4j7y+zIYVCSNmPJ7rkL+V3kAZ0en8nzFGf1z6+2zdZSzjh8M8kH1UxcnbiGEDyfuszYA1siex3JhTU'
    + 'Ox+WDrH3gkn2Ee8/qF38j/0lj/stY6op3W5uc3Rv7+RPKfq2tvMu6xxz8HPw8spZYvoAoramGGxmIe8IEhh6H09tlQvov9POv4sF'
    + '+b/J3OShu1yDf/CPkXUD6utIBe/jF2+rDG2ndA5C5WXsvWXmMpXUL5g8OZW3DjlwX1WN17U/6+LeRblWvsPPK0/JGor2llzh8GsX'
    + 'oyo76XrcTzeNTDNzCGpe5es3s95Q/uWvld8/Hph+oM/Wx1tWyFNfEwyKeB1dp5ygYIvcfOsXbf96LSUL5vvn2y+b9m8yHW6vHfT7'
    + 'U58iW2er1eP3cA5ug/PQH9WGHxUeTlDf6nB0uY/GBPNv93lQ8sGaxSSiX7OPLHNgDW2+k99SXQzmdLLv57gvif3n///omqG12NIC'
    + '7u/3s4DOYg5f8e+Yz+RiHI/zGSJxN+V5v8G7f572/ZK2foSEGm92+vVOyya5H/IT4vi237YsvlnV7gyLU0uHdkDF8nS+aTjrmNWj'
    + '8pd/oJbMUvUm3Gp3Ifj7yuu6iiTim2VVPjh3p5v2dCp+F3DKV8w4m5yefitsnftY78zo/sg3+nS+T/RfJ/ztrwmNP/LPL3RH5LyX'
    + '+obPlDzNgg5f9Nm4/sd8pH+zxLVy3YROT/kWa/2y3r8ftD1tXDF5H/J8mXHf6pX/TuQuFuDOfCNL0HndW1iPwLkT9clkM63UOxRV'
    + '6sL7aojqRhfiD093E6x4fcHCzJw6o2OqwmC4ZzgeofOkR+CfkbsUhYpCwJlkNdWi1SFhmLxTHSp/EpVytTlyRTvWee2JUoy7+VBF'
    + '35ors/ReofRFUmhh9ukSW+TN4ZS1kaLX8uPOXypaMw9X9G0FryEx337mltyZfOGdXVKnUWfiySj0XShw+H5djq3zSnlk5XrXXv3h'
    + 'T5g/PJ7zCtS/a7J7FP5N+a8mXNVUE+Kf9elB88FKvsFkvudlpFvknkN6/8LyfX+AH5nQ4p/68r/yvyHrpN3TQi/8aU//VVvsqCEw'
    + 'Qmkf+Hlf/1FR5z4ISIzalJan/X5gdJBumJeRdb4ihDKLdUnDEVB8lTe+Lzq6aUvxJnlN/hiG9NxTGxeupAfCxRrtEXW3wd8hMFQ+'
    + 'XHxsoxMqJpKLYsW0L+qlyeq6aydKOmlF8RZ/ilU+nqrU5apVaiZi03udM2924t8ve/Qb55Hvl7Ip+UT+ST8juaVUKJfFI+kU/KJ/'
    + 'JJ+UQ+Kf+2yZf+hlrkv0vfiLyxYktO51LxaYSKJ0Ye/SGOiSrIl76lYTn5jjgmVcmX16ijfNXJYym/+ohvJ98ljraUMyaKsyy57r'
    + 'p6uzrka0FHp1rxcTqtU9R4WfjOaW1JrfRUvyWLKjZP/uDvk78j8v+C8t9J+aR8Uj4pn5RPyiflk/L/vPL3pPxGlL+/aeVHSpqRik'
    + '8lXWmTe60EfI3EJemJ2SoHe2oCmERQfsZQHCN37XWSq2S6V6xcSB4bpJwnbUr5e/U+tqQa15dGouaR2LMza1RoeeK/ymP4TqwV+K'
    + 'URFdhpqgaZeo3mLZJ/JOr0zHxVLU/8ueTv2kb+gMj/NeUT+aR8Ip9sPtl8Uv79KX9PNr8R8vdk80n5N0X+5q0U8vfsxBa18LKWzf'
    + '8oP+NHhfLVeser8otNxDGBvNhOXpLle71knWuU5JvKrz5yRvU+ehrkf8gTyY912gGdRE0t5fsaZ/zSiQqsSKuMzmyd/DN/dS3Uiz'
    + 'O8I/J3N0C+2Tj5OyKflH9T5GvZ/Csrv7FrvCD5pHxSPtn8eySflE/KJ5tPNv+3YA5KX0vlNni7PX9t8qW/sy27Y4uyZy/p7ojFll'
    + 'g5o3x9VJDviWuTdbgNsSUSn0+PLE9e5xoTjV9dj3xDubO+OOP+usq/oKPT6TSdTPpVJ63yxGvUOWO9cX5SK9uZyG85+YPGyf8ryt'
    + '/fAPn7tpFPyifl/zL2RD4pn8gnm082n5RPyiflE/l/cpz/dVItey1PvHmeo1Mrp/brzDXrdufVztKqQVZLRNeptz84j/ydzhkbI/'
    + '+tKfL355G/a5z869TbJ+WT8u9M+bu2KX9Ayiflk/LJ5pPySfmkfLL5pHxSfqe56K3BgP2pKw6acp/4y4OmBt/3WTuIRmJ/ctvHLt'
    + 'um4+EzxLk8eWPlucV5dqai/EC5RvkXqA+o3CeudWeJ4x/KyV+KY3xxHfkMqDhPvsUqu57BIF82TX6/8re/SqLmmRjUUlVHY8HCqr'
    + 'bk3Kp5Oq2TTpDpl071QZ2lJK9ciq115Ff1Is6tmqfTLzmR/AGRT8q/J/LNWmNoUj4pn5RP5JPyiXxSPtl8Uv6vkf/+dtbrSLEjue'
    + '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'
    + 'AAAABJRU5ErkJggg==';
  const TABS = [
    { id: 'info',     label: '简介' },
    { id: 'comments', label: '评论' },
    { id: 'videos',   label: '视频' },
  ];
  const DEF_OPTS = [                       // v4.1 X：默认标签设置项
    { id: 'last',     label: '跟随上次' },
    { id: 'info',     label: '简介' },
    { id: 'comments', label: '评论' },
    { id: 'videos',   label: '视频' },
  ];

  const CSS = `
/* ========== B 站原生节点：移出文档流、默认隐藏（纯 CSS，不影响 Vue 挂载） ========== */
html.btv-on #v_desc,
html.btv-on .video-tag-container,
html.btv-on #commentapp,
html.btv-on .rcmd-tab {
  position: fixed !important;
  visibility: hidden !important;
  margin: 0 !important;
  z-index: 2;
  box-sizing: border-box;
  left: -99999px;
  top: 0;
  width: 0;
  height: 0;
  overflow: hidden;
}

/* ========== 请求 A：右栏"弹幕列表"整块删除（含其中广告位） ========== */
html.btv-on .right-container .video-pod-above-modules,
html.btv-on .right-container .video-pod-above-modules__inner,
html.btv-on .right-container .danmaku-box,
html.btv-on .right-container .right-bottom-banner {
  display: none !important;
}

/* 右内栏原有 250px 底部留白会让整页出现滚动条，清零 */
html.btv-on .right-container > .right-container-inner {
  padding-bottom: 0 !important;
}

/* ========== 请求 B：UP 主信息传送到左栏信息带左侧 ========== */
html.btv-on .up-panel-container.btv-up {
  position: fixed !important;
  left: var(--btv-up-l, -99999px) !important;
  top: var(--btv-up-t, 0) !important;
  width: var(--btv-up-w, 0) !important;
  height: var(--btv-up-h, 0) !important;
  margin: 0 !important;
  z-index: 2;
  display: flex !important;
  flex-direction: column;
  /* 顶部对齐（与标题同高），而不是在信息带里垂直居中——
     居中会在播放器与 UP 信息之间留出一段空白 */
  justify-content: flex-start;
  padding-top: var(--btv-band-pt, 8px) !important;
  overflow: hidden;
  pointer-events: auto !important;
}
/* 关键：右栏 .right-container-inner 是 position:sticky，本身构成层叠上下文，
   被传送到左栏的 UP 面板的 z-index 只在这个上下文内部排序；而左栏
   .left-container 是 position:sticky + z-index:1（B 站原生），整体压在面板之上，
   导致面板可见但命中测试全落在左栏盒子上（进主页/关注/充电/发消息全部点不动）。
   抬升右栏的层叠层级，被传送的节点才能真正浮在左栏之上。 */
html.btv-on .right-container {
  z-index: 3 !important;
}

/* ========== v3.8 N：整页贴边布局 ========== */
/* B 站主容器（#mirror-vdcon）是 flex 且把左右两栏整体居中——剩余空间左右平摊，
   造成：左栏（播放器/UP 信息带）离窗口左边有空白，右栏离窗口右边也有空白。
   改为左对齐 + 左内边距 24px（与顶栏 bilibili logo 的「B」字左缘一致，实测
   big-logo__logo svg left=24）；宽度改成 border-box 100% 抵消内边距增量，
   否则 content-box 下 padding 变大会撑出横向滚动条。 */
html.btv-on #mirror-vdcon.video-container-v1 {
  box-sizing: border-box !important;
  width: 100% !important;
  padding-left: 24px !important;
  padding-right: 0 !important;
  justify-content: flex-start !important;
}

/* ========== v3.9：视口底部不再露出页面灰底 ========== */
/* 隐藏右栏弹幕列表 / 底部横幅后，主容器高度（实测 947，底 1011）不足视口高
   （1080），视口最下方约 69px 露出 body 自身的灰底（#f1f2f3）——看起来像
   "页面缺了一块"。把页面底色统一成内容底色：浅色主题=白，暗色主题跟随
   --bg1 变量。只动 body 背景，不改任何盒模型。 */
html.btv-on body {
  background-color: var(--bg1, #fff) !important;
}

/* 信息带里的其它块（标题+播放量 / 三连栏）整体右移，给 UP 信息让位 */
html.btv-on #viewbox_report.btv-shift,
html.btv-on #arc_toolbar_report.btv-shift {
  margin-left: var(--btv-shift, 0px) !important;
}

/* ========== 请求 E：收紧左栏信息带的上下留白 ========== */
/* #viewbox_report 自带 22px 顶部内边距，外加一段固定尾部留白（非 padding），
   两者叠加使"播放器 → UP 信息/标题"之间出现明显空白 */
html.btv-on #viewbox_report {
  padding-top: var(--btv-band-pt, 8px) !important;
  padding-bottom: 0 !important;
  height: auto !important;
  min-height: 0 !important;
}
/* 三连栏的上下内边距 16/12 → 10/10，收紧"标题 → 三连栏"之间的空白 */
html.btv-on #arc_toolbar_report {
  padding-top: 10px !important;
  padding-bottom: 10px !important;
  height: auto !important;
}

/* ========== 传送槽位：激活的元素铺进标签内容区（几何全部来自 CSS 变量） ========== */
/* 槽位 A：满高（评论 / 推荐视频） */
html.btv-on #commentapp.btv-a,
html.btv-on .rcmd-tab.btv-a {
  left: var(--btv-l, 0) !important;
  top: var(--btv-t, 0) !important;
  width: var(--btv-w, 0) !important;
  height: var(--btv-h, 0) !important;
  visibility: visible !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
  overscroll-behavior: contain;
  pointer-events: auto !important; /* 右栏父容器是 pointer-events:none，必须显式恢复 */
}
/* 槽位 B：简介（高度自适应，上限 72% 面板高） */
html.btv-on #v_desc.btv-b {
  left: var(--btv-l, 0) !important;
  top: var(--btv-bt, 0) !important;
  width: var(--btv-w, 0) !important;
  height: auto !important;
  max-height: var(--btv-bh, 0) !important;
  visibility: visible !important;
  overflow-y: auto !important;
  overscroll-behavior: contain;
  pointer-events: auto !important;
}
/* 槽位 C：标签区（位于简介下方） */
html.btv-on .video-tag-container.btv-c {
  left: var(--btv-l, 0) !important;
  top: var(--btv-ct, 0) !important;
  width: var(--btv-w, 0) !important;
  height: auto !important;
  max-height: var(--btv-cbh, 0) !important;
  visibility: visible !important;
  overflow-y: auto !important;
  overscroll-behavior: contain;
  pointer-events: auto !important;
}

/* ========== 自建标签页 UI（挂在 body，Vue 零感知） ========== */
#btv-right-tabs {
  position: fixed;
  left: var(--btv-ui-l, -99999px);
  top: var(--btv-ui-t, 0);
  width: var(--btv-ui-w, 0);
  height: var(--btv-ui-h, 0);
  z-index: 6; /* 高于右栏（3）与 B 站右栏内容，保证标签按钮永远可点 */
  display: flex;
  flex-direction: column;
  pointer-events: none; /* 整体穿透，滚轮/点击直达被传送的面板 */
}
#btv-right-tabs[hidden-btv] { display: none; }
#btv-tab-header {
  position: relative; /* v4.1 X：默认标签弹层的定位锚 */
  pointer-events: auto; /* 只有标签按钮区可交互 */
  display: flex;
  gap: 6px;
  padding: 0 0 10px;
  border-bottom: 1px solid var(--line_regular, #e3e5e7);
  margin-bottom: 10px;
  flex-shrink: 0;
}
.btv-tab-btn {
  flex: 1;
  text-align: center;
  padding: 9px 0;
  border-radius: 6px;
  font-size: 14px;
  color: var(--text1, #18191c);
  background: var(--graph_bg_thin, #f1f2f3);
  cursor: pointer;
  user-select: none;
  transition: background-color .2s, color .2s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.btv-tab-btn:hover { background: var(--graph_bg_thick, #e3e5e7); }
.btv-tab-btn.active {
  background: var(--brand_blue, #00aeec);
  color: var(--text_white, #fff);
}
#btv-tab-content { /* 仅作为几何参照 + 说明性容器，对指针透明，让滚轮/点击穿透到被传送的面板 */
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  pointer-events: none;
}

/* ========== v4.1 X：默认标签设置（齿轮 + 弹层） ========== */
.btv-gear-btn {
  flex: 0 0 34px;
  text-align: center;
  padding: 9px 0;
  border-radius: 6px;
  font-size: 15px;
  color: var(--text3, #9499a0);
  background: var(--graph_bg_thin, #f1f2f3);
  cursor: pointer;
  user-select: none;
  transition: background-color .2s, color .2s;
}
.btv-gear-btn:hover { background: var(--graph_bg_thick, #e3e5e7); color: var(--text1, #18191c); }
#btv-defpop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 132px;
  background: var(--bg1, #fff);
  border: 1px solid var(--line_regular, #e3e5e7);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .08);
  padding: 6px;
  display: none;
  z-index: 7;
  pointer-events: auto;
}
#btv-defpop.open { display: block; }
.btv-defopt {
  padding: 7px 10px;
  font-size: 13px;
  color: var(--text2, #61666d);
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.btv-defopt:hover { background: var(--graph_bg_thin, #f1f2f3); }
.btv-defopt.sel { color: var(--brand_blue, #00aeec); font-weight: 500; }
.btv-defhint {
  padding: 6px 10px 2px;
  font-size: 11px;
  color: var(--text3, #9499a0);
  border-top: 1px solid var(--line_regular, #e3e5e7);
  margin-top: 4px;
}

/* ========== v4.2 Z：打赏（齿轮弹层入口 + 二维码浮层） ========== */
.btv-defsep {                                          /* 弹层内分隔线：设置项 / 打赏 之间 */
  height: 1px;
  margin: 6px 4px;
  background: var(--line_regular, #e3e5e7);
}
.btv-defaction {                                       /* 打赏入口：加粗 + 绿色 */
  padding: 7px 10px;
  font-size: 14px;
  font-weight: 700;
  color: #07c160;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: background-color .2s;
}
.btv-defaction:hover { background: rgba(7, 193, 96, .1); }
#btv-reward-mask {                                     /* 全屏遮罩：点遮罩任意处关闭 */
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, .55);
  z-index: 2147483000;                                 /* 盖过标签 UI（z=6/7）与 B 站浮层 */
  pointer-events: auto;
}
#btv-reward-mask.open { display: flex; }
.btv-reward-card {
  box-sizing: border-box;
  max-width: min(86vw, 340px);
  padding: 18px 18px 14px;
  background: var(--bg1, #fff);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, .22);
  text-align: center;
  color: var(--text1, #18191c);
}
.btv-reward-title { font-size: 15px; font-weight: 700; color: #07c160; }
.btv-reward-img {                                      /* v4.2.1：260 → 300px，二维码尽量大才好扫 */
  display: block;
  width: min(78vw, 300px);
  margin: 12px auto 0;
  border-radius: 8px;
  background: #fff;
}
.btv-reward-hint { margin-top: 10px; font-size: 12px; line-height: 1.6; color: var(--text3, #9499a0); }
.btv-reward-links { margin-top: 8px; font-size: 12px; line-height: 1.6; color: var(--text3, #9499a0); }
.btv-reward-links span {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
  transition: background-color .2s, color .2s;
}
.btv-reward-links span:hover { color: #07c160; background: rgba(7, 193, 96, .1); }
#btv-reward-reset { margin-left: 8px; padding-left: 12px; border-left: 1px solid var(--line_regular, #e3e5e7); }
.btv-reward-drop {                                     /* 未设置二维码时的导入区 */
  box-sizing: border-box;
  width: min(70vw, 260px);
  height: 150px;
  margin: 12px auto 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text3, #9499a0);
  background: var(--graph_bg_thin, #f1f2f3);
  border: 1px dashed var(--line_regular, #c9ccd0);
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
}
.btv-reward-drop.over { border-color: #07c160; background: rgba(7, 193, 96, .08); color: #07c160; }
.btv-reward-close {
  margin-top: 12px;
  padding: 7px 0;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text2, #61666d);
  background: var(--graph_bg_thin, #f1f2f3);
  cursor: pointer;
  user-select: none;
  transition: background-color .2s, color .2s;
}
.btv-reward-close:hover { background: var(--graph_bg_thick, #e3e5e7); color: var(--text1, #18191c); }

/* ========== v4.1.1：评论工具（字号 +/− 与回顶 ↑）移到「评论」标签两侧 ========== */
.btv-cmt-tool {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 4px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1;
  color: var(--text3, #9499a0);
  background: var(--graph_bg_thin, #f1f2f3);
  cursor: pointer;
  user-select: none;
  transition: background-color .2s, color .2s, opacity .2s;
}
.btv-cmt-tool:hover { background: var(--graph_bg_thick, #e3e5e7); color: var(--text1, #18191c); }
.btv-cmt-tool.off { opacity: .45; cursor: default; }      /* 已到 80% / 160% 边界 */
.btv-cmt-tool.off:hover { background: var(--graph_bg_thin, #f1f2f3); color: var(--text3, #9499a0); }
#btv-cmt-fs {
  display: flex;
  flex-direction: column;
  justify-content: center;    /* 两个小按钮在"整行高"的盒子里垂直居中 */
  gap: 2px;
  margin-right: 2px;          /* 与「评论」标签之间再多 2px（标签条本身有 6px gap） */
}
#btv-cmt-fs .btv-cmt-tool { width: 20px; height: 17px; font-size: 12px; }
/* 高度不写死：让 flex 拉伸到与本行标签按钮等高（字体/平台变了也自动跟齐） */
#btv-cmt-top { width: 30px; min-height: 36px; border-radius: 6px; font-size: 14px; }

/* ========== v4.1 V：评论区字号倍率（--btv-cfs 写在 <html>，默认 1） ==========
   四处落点（实测口径，v41_uname 补全第四条）：
   ① 面板级 —— #commentapp 自身 12px，calc 后"继承字号"的文本整体跟随；
   ② 正文级 —— bili-rich-text 自身 shadow 有显式 16px/26px 挡住继承，
      必须逐实例往它的 shadowRoot 注 :host/#contents 样式（JS: applyRichFonts，
      实测见 v41c C2）；custom property 可穿透 shadow 边界继承，calc 在这里可用；
   ③ 用户名级 —— bili-comment-user-info 的 #user-name 是显式 14px/21px，同样不吃
      继承，要往 user-info 的 shadowRoot 注样式（JS: applyUserFonts，见 v4.1 V2e）；
   ④ 时间级 —— #pubdate 内联字号（styleTimeNode 里同样走 calc）。 */
html.btv-on #commentapp.btv-a {
  font-size: calc(12px * var(--btv-cfs, 1)) !important;
}

/* ========== v4.1 Y：合集列表收起（.video-pod__body 整块隐藏） ========== */
html.btv-on .video-pod.btv-pod-collapsed .video-pod__body {
  display: none !important;
}
html.btv-on #btv-pod-toggle:hover {
  color: var(--text1, #18191c);
  background: var(--graph_bg_thick, #e3e5e7);
}
`;

  // ---------- 工具 ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const r2 = n => Math.round(n);

  let uiTabs = null, uiHeader = null, uiContent = null;
  let gear = null, defPop = null;                 // v4.1 X：默认标签设置弹层
  let cmtFs = null, cmtTop = null;                // v4.1.1：字号 +/− 组、回顶 ↑（「评论」标签两侧）
  let rewardMask = null, rewardImg = null;        // v4.2 Z：打赏浮层（遮罩 / 二维码图）
  let rewardDrop = null, rewardInput = null, rewardHint = null, rewardBtn = null;
  let rewardLinks = null, rewardSwap = null, rewardReset = null;   // v4.2.1：换图 / 恢复内置
  let currentTab = 'videos';
  let layoutTimer = 0;
  let enabled = false;

  function injectCSS() {
    if (document.getElementById('btv-style')) return;
    const s = document.createElement('style');
    s.id = 'btv-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function setVars(pairs) {
    const st = document.documentElement.style;
    pairs.forEach(([k, v]) => { if (v == null) st.removeProperty(k); else st.setProperty(k, v); });
  }

  // B 站应用是否启动完成（hydration 结束、播放器就绪）
  function siteBooted() {
    return !!window.player
      || !!$('#bilibili-player video, #bilibili-player iframe, .bpx-player-container');
  }

  function isRightVisible() {
    const rc = $('.right-container');
    if (!rc) return false;
    const cs = getComputedStyle(rc);
    return cs.display !== 'none' && rc.getBoundingClientRect().width > 10;
  }

  function isVideoPage() {
    return !!$('#mirror-vdcon.video-container-v1') && !!$('.right-container-inner');
  }

  // ---------- 标签 UI（挂在 body） ----------
  function ensureUI() {
    if (uiTabs && document.getElementById('btv-right-tabs')) return;
    uiTabs = document.createElement('div');
    uiTabs.id = 'btv-right-tabs';
    uiHeader = document.createElement('div');
    uiHeader.id = 'btv-tab-header';
    TABS.forEach(t => {
      const btn = document.createElement('div');
      btn.className = 'btv-tab-btn';
      btn.dataset.btvTab = t.id;
      btn.textContent = t.label;
      btn.addEventListener('click', () => activate(t.id));
      if (t.id === 'comments') {
        // v4.1.1：字号 +/− 组在「评论」左侧，回顶 ↑ 在右侧（用户指定落点）
        cmtFs = buildCmtFs();
        cmtTop = buildCmtTop();
        uiHeader.appendChild(cmtFs);
        uiHeader.appendChild(btn);
        uiHeader.appendChild(cmtTop);
      } else {
        uiHeader.appendChild(btn);
      }
    });
    uiContent = document.createElement('div');
    uiContent.id = 'btv-tab-content';
    uiTabs.appendChild(uiHeader);
    uiTabs.appendChild(uiContent);
    document.body.appendChild(uiTabs);

    // ---- v4.1 X：默认标签设置（齿轮按钮 + 下拉弹层，挂在标签头最右） ----
    gear = document.createElement('div');
    gear.className = 'btv-gear-btn';
    gear.id = 'btv-gear';
    gear.textContent = '⚙';
    gear.title = '默认展示的标签';
    gear.addEventListener('click', function (ev) {
      ev.stopPropagation();
      refreshDefPop();
      defPop.classList.toggle('open');
    });
    uiHeader.appendChild(gear);
    defPop = document.createElement('div');
    defPop.id = 'btv-defpop';
    DEF_OPTS.forEach(o => {
      const it = document.createElement('div');
      it.className = 'btv-defopt';
      it.dataset.btvDef = o.id;
      it.textContent = o.label;
      it.addEventListener('click', function (ev) {
        ev.stopPropagation();
        try { localStorage.setItem(DEF_TAB_KEY, o.id); } catch (e) { /* ignore */ }
        refreshDefPop();
        defPop.classList.remove('open');
      });
      defPop.appendChild(it);
    });
    const hint = document.createElement('div');
    hint.className = 'btv-defhint';
    hint.textContent = '打开页面时默认展示';
    defPop.appendChild(hint);
    // ---- v4.2 Z：打赏入口（加粗绿字，点击弹二维码浮层） ----
    const sep = document.createElement('div');
    sep.className = 'btv-defsep';
    defPop.appendChild(sep);
    rewardBtn = document.createElement('div');
    rewardBtn.className = 'btv-defaction';
    rewardBtn.id = 'btv-reward-btn';
    rewardBtn.textContent = '打赏';
    rewardBtn.title = '微信扫码打赏';
    rewardBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      defPop.classList.remove('open');
      openReward();
    });
    defPop.appendChild(rewardBtn);
    uiHeader.appendChild(defPop);
    // 点弹层外任意处关闭（捕获阶段；齿轮/弹层自身点击已 stopPropagation）
    document.addEventListener('click', function (ev) {
      if (!defPop) return;
      if (defPop.contains(ev.target) || (gear && gear.contains(ev.target))) return;
      defPop.classList.remove('open');
    }, true);
  }

  // ---- v4.2 Z：打赏浮层（二维码来源：localStorage 覆盖 > 内置 REWARD_QR > 现场导入） ----
  function rewardLocal() {
    try { return localStorage.getItem(REWARD_KEY) || ''; } catch (e) { return ''; }
  }
  function rewardSrc() {
    return rewardLocal() || REWARD_QR;
  }

  function ensureRewardUI() {
    if (rewardMask) return;
    rewardMask = document.createElement('div');
    rewardMask.id = 'btv-reward-mask';
    const card = document.createElement('div');
    card.className = 'btv-reward-card';
    const title = document.createElement('div');
    title.className = 'btv-reward-title';
    title.textContent = '打赏支持';
    card.appendChild(title);
    rewardImg = document.createElement('img');
    rewardImg.className = 'btv-reward-img';
    rewardImg.alt = '打赏二维码';
    rewardImg.referrerPolicy = 'no-referrer';
    card.appendChild(rewardImg);
    rewardDrop = document.createElement('div');
    rewardDrop.className = 'btv-reward-drop';
    rewardDrop.textContent = '把二维码图片拖到这里，或点击选择图片';
    card.appendChild(rewardDrop);
    rewardInput = document.createElement('input');
    rewardInput.type = 'file';
    rewardInput.accept = 'image/*';
    rewardInput.style.display = 'none';
    card.appendChild(rewardInput);
    rewardHint = document.createElement('div');
    rewardHint.className = 'btv-reward-hint';
    rewardHint.textContent = '微信扫码 · 感谢支持';
    card.appendChild(rewardHint);
    // v4.2.1：换图入口（本地覆盖 localStorage，优先于脚本内置的那张）
    rewardLinks = document.createElement('div');
    rewardLinks.className = 'btv-reward-links';
    rewardSwap = document.createElement('span');
    rewardSwap.id = 'btv-reward-swap';
    rewardSwap.textContent = '换一张';
    rewardSwap.title = '把自己现在的收款码导入，只存在本机浏览器里';
    rewardSwap.addEventListener('click', function () { rewardInput.click(); });
    rewardLinks.appendChild(rewardSwap);
    rewardReset = document.createElement('span');
    rewardReset.id = 'btv-reward-reset';
    rewardReset.textContent = '恢复内置';
    rewardReset.title = '清掉本机导入的二维码，回到脚本内置的那张';
    rewardReset.addEventListener('click', function () {
      try { localStorage.removeItem(REWARD_KEY); } catch (e) { /* ignore */ }
      refreshRewardImg();
    });
    rewardLinks.appendChild(rewardReset);
    card.appendChild(rewardLinks);
    const close = document.createElement('div');
    close.className = 'btv-reward-close';
    close.textContent = '关闭';
    close.addEventListener('click', closeReward);
    card.appendChild(close);
    rewardMask.appendChild(card);
    document.body.appendChild(rewardMask);

    rewardMask.addEventListener('click', function (ev) {           // 点遮罩空白处关闭
      if (ev.target === rewardMask) closeReward();
    });
    rewardDrop.addEventListener('click', function () { rewardInput.click(); });
    rewardInput.addEventListener('change', function () {
      handleRewardFile(rewardInput.files && rewardInput.files[0]);
    });
    ['dragenter', 'dragover'].forEach(t => rewardDrop.addEventListener(t, function (ev) {
      ev.preventDefault(); rewardDrop.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(t => rewardDrop.addEventListener(t, function (ev) {
      ev.preventDefault(); rewardDrop.classList.remove('over');
    }));
    rewardDrop.addEventListener('drop', function (ev) {
      const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      handleRewardFile(f);
    });
  }

  function handleRewardFile(file) {
    if (!file || !/^image\//.test(file.type || '')) return;
    const rd = new FileReader();
    rd.onload = function () {
      const url = String(rd.result || '');
      if (url.length > 2500000) {            // localStorage 常见 5MB 上限，留足余量
        if (rewardHint) rewardHint.textContent = '图片过大，请压缩到 1.5MB 以内';
        return;
      }
      try { localStorage.setItem(REWARD_KEY, url); } catch (e) { /* 超配额：本次会话内仍可用 */ }
      refreshRewardImg();                    // 文案（含"已用本机自定义的码"）由它统一维护
    };
    rd.readAsDataURL(file);
  }

  // 有图显示图（外加"换一张/恢复内置"），没图显示导入区。文案随来源变化。
  function refreshRewardImg() {
    if (!rewardImg) return;
    const src = rewardSrc();
    const local = rewardLocal();
    if (src) {
      rewardImg.src = src;
      rewardImg.style.display = 'block';
      rewardDrop.style.display = 'none';
      rewardLinks.style.display = 'block';
      rewardReset.style.display = local ? 'inline' : 'none';   // 没本机覆盖就没什么可恢复的
      rewardHint.textContent = local ? '微信扫码打赏 · 已用本机自定义的码'
                                     : '微信扫码打赏 · 感谢支持';
    } else {
      rewardImg.removeAttribute('src');
      rewardImg.style.display = 'none';
      rewardDrop.style.display = 'flex';
      rewardLinks.style.display = 'none';
      rewardHint.textContent = '还没有二维码，把图片拖进上面即可';
    }
  }

  function openReward() {
    ensureRewardUI();
    refreshRewardImg();
    rewardMask.classList.add('open');
  }

  function closeReward() {
    if (rewardMask) rewardMask.classList.remove('open');
  }

  function dropRewardUI() {                   // 停用/还原时整块移除，不留遮罩
    if (rewardMask && rewardMask.parentNode) rewardMask.parentNode.removeChild(rewardMask);
    rewardMask = rewardImg = rewardDrop = rewardInput = rewardHint = null;
    rewardLinks = rewardSwap = rewardReset = null;
  }

  // 弹层选项的选中态刷新（读 localStorage，跟存储永远是同步的）
  function refreshDefPop() {
    if (!defPop) return;
    let cur = 'last';
    try { cur = localStorage.getItem(DEF_TAB_KEY) || 'last'; } catch (e) { /* ignore */ }
    $$('.btv-defopt', defPop).forEach(it => {
      it.classList.toggle('sel', it.dataset.btvDef === cur);
    });
  }

  // ---------- 几何计算 ----------
  // 标签页顶边锚点：左栏第一个"还在原位"的可见块的顶边
  // （经典版式 = 播放器；新版式 = 标题块）。这样标签页顶边与播放窗口顶边对齐——
  // 右栏顶边在部分版式里比左栏高几像素，直接锚右栏会左右不齐。
  function tabAnchorTop() {
    const lc = $('.left-container');
    if (!lc) return null;
    const lcr = lc.getBoundingClientRect();
    let best = null;
    Array.from(lc.children).forEach(el => {
      if (el.classList.contains('btv-a') || el.classList.contains('btv-b') || el.classList.contains('btv-c')) return;
      const r = el.getBoundingClientRect();
      if (r.height < 4 || r.top < 0) return;
      // 已被传送/移出视口的节点（left:-99999px）不算数——
      // .video-tag-container 移出后仍测得 height 7px、top 0，曾把锚点拽到 0
      if (r.left < lcr.left - 8 || r.right > lcr.right + 8) return;
      if (best == null || r.top < best) best = r.top;
    });
    // 第一个块就是播放器、且它内部还有留白时，跟到播放器真正的顶边
    const pw = $('#playerWrap');
    if (pw && best != null && Math.abs(pw.getBoundingClientRect().top - best) < 1.5) {
      const inner = $('.bpx-docker-major', pw) || $('#bilibili-player', pw);
      if (inner) {
        const ri = inner.getBoundingClientRect();
        if (ri.height > 4 && ri.top > best && ri.top < best + 60) best = ri.top;
      }
    }
    return best;
  }

  // 右栏标签页区域：锚点（默认右栏顶）→ 视口底部
  function tabAreaBox() {
    const rc = $('.right-container');
    if (!rc) return null;
    const rcr = rc.getBoundingClientRect();
    const anchor = tabAnchorTop();
    let top = (anchor != null && Math.abs(anchor - rcr.top) < 400) ? anchor : rcr.top;
    // 未被隐藏/传送的右栏模块（例如多 P 的"选集"）要让出位置；
    // 注意排除已被传送到标签内容区的节点（它们的 rect 不在右栏原位）
    const kept = ['.video-pod', '#multi_page', '.right-bottom-banner'];
    kept.forEach(sel => {
      $$(sel, rc).forEach(el => {
        if (el.closest('.rcmd-tab, #commentapp, #v_desc, .video-tag-container')) return;
        if (el.closest('#btv-right-tabs')) return;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const r = el.getBoundingClientRect();
        if (r.height > 4 && r.bottom + 12 > top) top = r.bottom + 12;
      });
    });
    const docEl = document.documentElement;
    const vw = window.innerWidth || docEl.clientWidth;
    // v3.8 O：右缘贴到视口右缘（宽度只取右栏原生宽 rcr.width 时会与窗口右边
    // 隔着主容器居中摊出来的空白；改为「视口宽 - 右栏左缘」，把居中释放的空间
    // 全部吸收进标签页）。nativeW 保留右栏原生宽给 UP 面板用。
    // v3.9.1 T：右缘必须给滚动条 + 视觉留白让位，否则最右标签的圆角被压掉。
    //   两种滚动条都要考虑：
    //   ① 经典（占位）滚动条：window.innerWidth 含它、clientWidth 不含，
    //      两者之差就是它的宽度（Windows Chrome 常见 15px）；
    //   ② 遮罩式滚动条（overlay）：不占布局 → 差值为 0，但它照样浮在
    //      内容最右 ~15px 上。
    //   所以取「max(实际滚动条宽, 15) + 8px 呼吸位」，两种情况都能让开 8px。
    //   （实测 v3.8 O 的旧写法：15px 滚动条下 btn.right=1920 > clientWidth=1905，
    //   elementFromPoint 在圆角处直接返回 null —— 不只是难看，还点不到。）
    const sbw = Math.max(0, vw - (docEl.clientWidth || vw));
    const reserve = Math.max(sbw, 15) + 8;
    const width = Math.max(320, vw - rcr.left - reserve);
    const height = Math.max(320, (docEl.clientHeight || window.innerHeight) - top - 14);
    return { left: rcr.left, width, top, height, nativeW: rcr.width };
  }

  // 左栏信息带：UP 信息与"标题/播放量/三连栏"共用的一行
  function infoBand() {
    const lc = $('.left-container');
    const vb = $('#viewbox_report');
    const pw = $('#playerWrap');
    if (!lc || !vb || !pw) return null;
    const lcr = lc.getBoundingClientRect();
    const vbr = vb.getBoundingClientRect();
    const pwr = pw.getBoundingClientRect();
    const tb = $('#arc_toolbar_report');
    const tbr = tb ? tb.getBoundingClientRect() : null;
    const titleBelowPlayer = vbr.top >= pwr.bottom - 8;   // 经典版式：标题在播放器下方
    let top = vbr.top, bottom = vbr.bottom;
    if (titleBelowPlayer && tbr) bottom = Math.max(bottom, tbr.bottom);
    return { left: lcr.left, top, height: Math.max(84, bottom - top), shift: [vb, tb] };
  }

  function clearSlots() {
    $$('#commentapp, .rcmd-tab, #v_desc, .video-tag-container').forEach(el => {
      el.classList.remove('btv-a', 'btv-b', 'btv-c');
    });
  }

  function layout() {
    if (!enabled || !uiTabs) return;
    const box = tabAreaBox();
    if (!box) return;
    const headerH = uiHeader ? uiHeader.getBoundingClientRect().height : 56;
    const cTop = box.top + headerH;
    const cH = Math.max(200, box.height - headerH);

    // UI 与内容区共用左/宽
    setVars([
      ['--btv-ui-l', r2(box.left) + 'px'],
      ['--btv-ui-t', r2(box.top) + 'px'],
      ['--btv-ui-w', r2(box.width) + 'px'],
      ['--btv-ui-h', r2(box.height) + 'px'],
      ['--btv-l', r2(box.left) + 'px'],
      ['--btv-w', r2(box.width) + 'px'],
      ['--btv-t', r2(cTop) + 'px'],
      ['--btv-h', r2(cH) + 'px'],
      // 面板底边到视口底边的距离：兜底重锚 B 站吸底 wrapper 时用（v3.6 修复 L）
      ['--btv-ab', r2(Math.max(0, (window.innerHeight || 0) - (box.top + box.height))) + 'px'],
    ]);

    // v3.8：UP 面板沿用右栏「原生宽」（411 一档），不用被撑宽后的标签页宽度，
    // 否则 clamp 到 440 会把左栏信息带的标题挤得更靠右
    applyUpPanel(box.nativeW || box.width);

    clearSlots();
    if (currentTab === 'info') {
      const desc = $('#v_desc');
      const tags = $('.video-tag-container');
      if (desc) {
        setVars([['--btv-bt', r2(cTop) + 'px'], ['--btv-bh', r2(cH * 0.72) + 'px']]);
        desc.classList.add('btv-b');
        const dh = Math.min(desc.getBoundingClientRect().height, Math.round(cH * 0.72));
        setVars([['--btv-ct', r2(cTop + dh + 10) + 'px'], ['--btv-cbh', r2(Math.max(60, cH - dh - 10)) + 'px']]);
        if (tags) tags.classList.add('btv-c');
      } else if (tags) {
        setVars([['--btv-ct', r2(cTop) + 'px'], ['--btv-cbh', r2(cH) + 'px']]);
        tags.classList.add('btv-c');
      }
    } else if (currentTab === 'comments') {
      const ca = $('#commentapp');
      if (ca) ca.classList.add('btv-a');
    } else {
      const rc = $('.rcmd-tab');
      if (rc) rc.classList.add('btv-a');
    }
  }

  // UP 主信息搬到左栏信息带左侧，标题/三连栏右移让位
  function applyUpPanel(rightWidth) {
    const up = $('.up-panel-container');
    const band = infoBand();
    if (!up || !band) return;
    const upW = Math.min(440, Math.max(280, rightWidth));
    const gap = 16;
    setVars([
      ['--btv-up-l', r2(band.left) + 'px'],
      ['--btv-up-t', r2(band.top) + 'px'],
      ['--btv-up-w', r2(upW) + 'px'],
      ['--btv-up-h', r2(band.height) + 'px'],
      ['--btv-shift', r2(upW + gap) + 'px'],
    ]);
    up.classList.add('btv-up');
    band.shift.forEach(el => { if (el) el.classList.add('btv-shift'); });
  }

  function retractUpPanel() {
    const up = $('.up-panel-container');
    if (up) up.classList.remove('btv-up');
    $$('#viewbox_report, #arc_toolbar_report').forEach(el => el.classList.remove('btv-shift'));
    setVars([
      ['--btv-up-l', null], ['--btv-up-t', null], ['--btv-up-w', null], ['--btv-up-h', null],
      ['--btv-shift', null],
    ]);
  }

  // ---------- 请求 F：评论区外观微调（v3.2 重写） ----------
  // B 站评论是 Web Component（#commentapp > bili-comments），内容层层套在 shadow DOM 中。
  // 不同版式 / 登录状态下嵌套层数与 class 名都会变，所以这里不再假设固定层级：
  //   1) 深度遍历所有 shadowRoot 找评论卡片（带节点预算，避免极端情况卡顿）；
  //   2) 视觉改动一律写内联 style —— 内联样式对 shadow 内部元素 100% 生效，
  //      不受嵌套层数、组件重建、样式表作用域影响；shadowRoot 内的 <style> 仅作补充。
  // 目标：时间（#pubdate）从操作行搬到用户名之后，点赞/踩/回复/更多 靠右对齐。
  const COMMENT_ACT_CSS = `:host { justify-content: flex-end !important; }\n`;
  const TIME_RE = /^(\d{4}-\d{2}-\d{2}|\d{1,2}-\d{1,2}|\d+月\d+日|\d+\s*(分钟|小时|天|周|个月|年)前|刚刚|昨天|前天)/;
  const ACT_TAG = 'BILI-COMMENT-ACTION-BUTTONS-RENDERER';
  const INFO_TAG = 'BILI-COMMENT-USER-INFO';
  const RICH_TAG = 'BILI-RICH-TEXT';                             // v4.1 V：评论正文（字号落点）
  const BOX_TAG = 'BILI-COMMENTS-HEADER-RENDERER';          // 装着"发表评论"框的头部组件
  const FLOAT_CLS = 'bili-comments-bottom-fixed-wrapper';   // B 站吸底传送生成的错位 wrapper

  function shadowStyle(root, css) {
    if (!root) return;
    try {
      let st = root.querySelector('style[data-btv-shadow]');
      if (!st) {
        st = document.createElement('style');
        st.setAttribute('data-btv-shadow', '');
        root.appendChild(st);
      }
      if (st.textContent !== css) st.textContent = css;
    } catch (e) { /* ignore */ }
  }

  // 深度遍历：穿透任意层 shadowRoot 收集操作行 / 用户名节点 / 评论框头部组件 / 吸底 wrapper
  function deepCollect(rootEl, budget) {
    const acts = [], infos = [], boxes = [], floats = [], avatars = [], bodies = [], riches = [];
    if (!rootEl) return { acts: acts, infos: infos, boxes: boxes, floats: floats, avatars: avatars, bodies: bodies, riches: riches };
    const queue = [];
    if (rootEl.shadowRoot) queue.push(rootEl.shadowRoot);
    queue.push(rootEl);
    let n = 0;
    const limit = budget || 20000;
    while (queue.length && n < limit) {
      const node = queue.shift();
      if (rootEl.id === 'commentapp') observeCmtRoot(node);   // v4.2.2：BFS 顺带挂脏标记 observer
      let list = null;
      try { list = node.querySelectorAll('*'); } catch (e) { continue; }
      for (let i = 0; i < list.length; i++) {
        const el = list[i];
        n++;
        if (el.tagName === ACT_TAG) acts.push(el);
        else if (el.tagName === INFO_TAG) infos.push(el);
        else if (el.tagName === BOX_TAG) boxes.push(el);
        else if (el.tagName === RICH_TAG) riches.push(el);    // v4.1 V：正文逐实例注入字号样式
        else if (el.id === 'user-avatar') avatars.push(el);   // v3.8 P：还原头像偏移用
        else if (el.id === 'body') bodies.push(el);           // v3.8 Q：还原卡片顶部内边距用
        else if (el.classList && el.classList.contains(FLOAT_CLS)) floats.push(el);
        if (el.shadowRoot) queue.push(el.shadowRoot);
        if (n >= limit) break;
      }
    }
    return { acts: acts, infos: infos, boxes: boxes, floats: floats, avatars: avatars, bodies: bodies, riches: riches };
  }

  function looksLikeTime(txt) {
    const s = (txt || '').trim();
    return s.length > 0 && s.length <= 24 && TIME_RE.test(s);
  }

  // 找"时间"节点：优先 B 站固定 id，其次在操作行 shadowRoot 的直接子节点里按文本识别
  function findTimeNode(asr) {
    if (!asr) return null;
    let t = null;
    try { t = asr.querySelector('#pubdate'); } catch (e) { t = null; }
    if (!t) { try { t = asr.querySelector('[id*="pubdate" i]'); } catch (e) { t = null; } }
    if (!t) { try { t = asr.querySelector('[class*="pubdate" i]'); } catch (e) { t = null; } }
    if (t) return t;
    const kids = Array.from(asr.children);
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (c.tagName === 'STYLE' || c.tagName === 'SCRIPT') continue;
      if (c.querySelector('button, a, bili-icon, svg')) continue;  // 按钮 / 图标不是时间
      if (c.children.length > 1) continue;                         // 最多允许一层包裹
      if (looksLikeTime(c.textContent)) return c;
    }
    return null;
  }

  const HEAD_PROPS = ['display', 'align-items', 'gap', 'min-width', 'flex-wrap'];

  // 名字行：只有在"容器里只装用户名"时才做 flex 化。
  // 楼中楼是紧凑排版，同一个容器往往还装着正文 —— 那种情况改 display 会把中文正文
  // 压进一个极窄的列里，表现为"一个字一行"（v3.2.0 实测 bug）。
  function styleHeadRow(head, hasBody) {
    head.setAttribute('data-btv-head', '');
    if (hasBody) {
      // 不动 display，只清掉可能残留的旧样式
      HEAD_PROPS.forEach(p => head.style.removeProperty(p));
      return;
    }
    head.style.setProperty('display', 'flex', 'important');
    head.style.setProperty('align-items', 'center', 'important');
    head.style.setProperty('flex-wrap', 'nowrap', 'important');
  }

  function undoHead(head) {
    head.removeAttribute('data-btv-head');
    HEAD_PROPS.forEach(p => head.style.removeProperty(p));
  }

  function styleTimeNode(t, hasBody) {
    t.setAttribute('data-btv-time', '');
    // B 站给 #pubdate 的是窄列宽，会把「2025-07-21 18:17」折成两行 —— 必须显式放宽
    t.style.setProperty('width', 'auto', 'important');
    t.style.setProperty('max-width', 'none', 'important');
    t.style.setProperty('min-width', '0', 'important');
    t.style.setProperty('white-space', 'nowrap', 'important');
    t.style.setProperty('color', 'var(--text3, #9499a0)', 'important');
    // v4.1 V：字号/行高跟随倍率 --btv-cfs（默认 1 时与原生 12px/16px 等值）
    t.style.setProperty('font-size', 'calc(12px * var(--btv-cfs, 1))', 'important');
    t.style.setProperty('line-height', 'calc(16px * var(--btv-cfs, 1))', 'important');
    t.style.setProperty('font-weight', 'normal', 'important');
    t.style.setProperty('flex', '0 0 auto', 'important');
    // 用自身 margin 代替父容器的 gap —— 不给父容器布局施压（"紧贴"名字，留一点呼吸位）
    t.style.setProperty('margin', '0 0 0 6px', 'important');
    t.style.setProperty('position', 'static', 'important');
    if (hasBody) {
      // 紧凑排版：时间以行内元素紧跟用户名，父容器保持原样
      t.style.setProperty('display', 'inline-block', 'important');
      t.style.setProperty('vertical-align', 'middle', 'important');
    } else {
      t.style.removeProperty('display');
      t.style.removeProperty('vertical-align');
    }
  }

  const TIME_PROPS = ['width', 'max-width', 'min-width', 'white-space', 'color', 'font-size',
    'line-height', 'font-weight', 'flex', 'margin', 'position', 'display', 'vertical-align'];

  function resetTimeNode(t) {
    if (!t) return;
    try {
      t.removeAttribute('data-btv-time');
      TIME_PROPS.forEach(p => t.style.removeProperty(p));
    } catch (e) { /* ignore */ }
  }

  // 取文本：bili-rich-text 的正文在它自己的 shadow DOM 里，宿主 textContent 是空串
  function elementText(el) {
    if (!el) return '';
    let t = '';
    try { t = el.textContent || ''; } catch (e) { t = ''; }
    if (!t.trim()) {
      try { if (el.shadowRoot) t = el.shadowRoot.textContent || ''; } catch (e) { /* ignore */ }
    }
    return t;
  }

  // 布局自检：正文是否被挤成"一字一行"（容器被误改 display 的典型症状）
  function layoutSane(head) {
    try {
      const rt = head.querySelector('bili-rich-text')
        || (head.parentElement && head.parentElement.querySelector('bili-rich-text'));
      if (!rt) return true;
      const txt = elementText(rt).trim();
      if (txt.length < 4) return true;
      const w = rt.getBoundingClientRect().width;
      return !(w > 0 && w < 24);
    } catch (e) { return true; }
  }

  // ---------- v3.4：时间"紧贴名字右侧同一行"的校验与自适应摆放 ----------
  // 楼中楼是紧凑排版：名字行容器可能同时装着正文，B 站还可能让 user-info 是块级、
  // 或者让名字行容器是"列方向 flex" —— 这些情况下把时间节点搬进去，它只会掉到
  // 名字"下面"一行（v3.3 实测）。所以改成：放进去 → **测量** → 不满足就换策略 →
  // 都不行就整体还原并跳过该卡片。测量是唯一判据，不再靠猜层级。
  let cmtTick = 0;

  function rectOf(el) { try { return el.getBoundingClientRect(); } catch (e) { return null; } }
  function usableRect(r) { return !!r && r.width > 0 && r.height > 0; }

  // 名字文本节点（user-info 的 shadow DOM 里通常是 #user-name > a）
  function nameNode(info) {
    if (!info) return null;
    try {
      const sr = info.shadowRoot;
      if (sr) {
        const n = sr.querySelector('#user-name a, [id*="user-name" i] a, [class*="user-name" i] a');
        if (n) return n;
      }
    } catch (e) { /* ignore */ }
    return info;
  }

  // 时间是否已经在名字右侧同一行（测不准时返回 true，保持现状）
  function timeBesideName(info, t) {
    if (!info || !t) return true;
    const rn = rectOf(nameNode(info)) || rectOf(info), rt = rectOf(t);
    if (!usableRect(rn) || !usableRect(rt)) return true;
    const rowTol = Math.max(6, rn.height * 0.7);
    return Math.abs(rt.top - rn.top) < rowTol && rt.left > rn.left;
  }

  function nudge(el, list, props) {
    const rec = { el: el, props: [] };
    props.forEach(p => {
      try {
        // 已经是同样的内联值 → 不重复记录，否则撤销时会把别人设的同一属性一起抹掉
        if (el.style.getPropertyValue(p[0]) === p[1]
          && el.style.getPropertyPriority(p[0]) === 'important') return;
        el.style.setProperty(p[0], p[1], 'important'); rec.props.push(p[0]);
      } catch (e) { /* ignore */ }
    });
    if (!rec.props.length) return;
    try { el.setAttribute('data-btv-nudge', ''); } catch (e) { /* ignore */ }
    list.push(rec);
  }

  function undoNudges(list) {
    (list || []).forEach(rec => {
      try {
        rec.props.forEach(p => rec.el.style.removeProperty(p));
        rec.el.removeAttribute('data-btv-nudge');
      } catch (e) { /* ignore */ }
    });
  }

  // 策略 A：user-info 不是"原子行内元素"时，time 跟在它后面必然另起一行。
  //   block/list-item/inline（内含块级子元素会被拆行）→ 行内块；
  //   flex/grid → 行内 flex/grid（内部仍是原来的布局）。
  function nudgeInfoInline(info, list) {
    let d = '';
    try { d = getComputedStyle(info).display; } catch (e) { return false; }
    if (!d || d === 'none' || d === 'contents') return false;
    if (d === 'inline-block' || d === 'inline-flex' || d === 'inline-grid') return false;  // 已原子化
    const v = (d === 'flex') ? 'inline-flex' : (d === 'grid' ? 'inline-grid' : 'inline-block');
    nudge(info, list, [['display', v], ['vertical-align', 'middle']]);
    return true;
  }

  // 策略 B：名字行是 flex 容器 → 让"名字 + 时间"独占第一行，其余子元素各占整行
  function nudgeFlexRows(head, info, t, list) {
    let cs = null;
    try { cs = getComputedStyle(head); } catch (e) { return false; }
    if (!/flex|grid/.test(cs.display)) return false;
    const props = [['flex-wrap', 'wrap'], ['align-content', 'flex-start']];
    if (cs.display === 'flex' && cs.flexDirection === 'column') props.push(['flex-direction', 'row']);
    nudge(head, list, props);
    Array.from(head.children).forEach(c => {
      if (c === info || c === t) return;
      if (c.tagName === 'STYLE' || c.tagName === 'SCRIPT') return;
      const cls = typeof c.className === 'string' ? c.className : '';
      if (c.tagName === 'BILI-AVATAR' || /avatar/i.test(cls) || c.id === 'user-avatar') return;
      nudge(c, list, [['flex', '1 0 100%'], ['min-width', '0']]);
    });
    return true;
  }

  // ---------- v3.5：楼中楼正文必须"另起一行"，不许紧贴名字/时间后面 ----------
  // 楼中楼是紧凑排版：用户名、时间、正文在同一个容器里按**行内流**排列。于是
  // "把时间放到名字右侧"落地后，正文就顺势紧跟在时间后面同一行了。这里把正文
  // 强制成"整行盒"（块级 / 独占一行的 flex item），让它落到名字行下面。
  function bodyNode(head) {
    if (!head) return null;
    try { return head.querySelector('bili-rich-text') || null; } catch (e) { return null; }
  }

  // 名字行底部（名字与时间中较低的那个）
  function nameRowBottom(info, t) {
    const rn = rectOf(nameNode(info)) || rectOf(info);
    const rt = t ? rectOf(t) : null;
    let b = usableRect(rn) ? rn.bottom : 0;
    if (usableRect(rt)) b = Math.max(b, rt.bottom);
    return b;
  }

  // 正文是否已经另起一行（测不准时返回 true，保持现状）
  function bodyOnOwnLine(info, t, body) {
    const rb = rectOf(body), rb2 = nameRowBottom(info, t);
    if (!usableRect(rb) || !rb2) return true;
    return rb.top >= rb2 - 2;
  }

  // 正文独占一行的改法：块级盒在行内流里必然另起一行；flex/grid 容器则让容器
  // 允许换行 + 正文占满一整行。若名字本身有左缩进（容器里还有头像），补同样的
  // 左缩进，让正文与名字左对齐而不是顶到容器最左边。
  function nudgeBodyOwnLine(head, body, info, list) {
    if (!head || !body) return false;
    let cs = null;
    try { cs = getComputedStyle(head); } catch (e) { return false; }
    const props = [['display', 'block'], ['min-width', '0'], ['max-width', 'none']];
    if (/grid/.test(cs.display)) {
      props.push(['grid-column', '1 / -1']);
    } else if (/flex/.test(cs.display)) {
      nudge(head, list, [['flex-wrap', 'wrap']]);
      props.push(['flex', '0 1 100%']);
    }
    // 与名字左对齐（名字左边缘相对容器内容区左侧的偏移）
    const rn = rectOf(nameNode(info)) || rectOf(info), rh = rectOf(head);
    if (usableRect(rn) && usableRect(rh)) {
      let pad = 0;
      try {
        pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
      } catch (e) { pad = 0; }
      const indent = Math.round(rn.left - (rh.left + pad));
      if (indent > 4) props.push(['margin-left', indent + 'px']);
    }
    nudge(body, list, props);
    return true;
  }

  // ---------- 评论框吸底传送拦截（v3.6 修复 L） ----------
  // B 站 teleportCommentbox(false) 会把评论框搬进 position:fixed 的 wrapper，
  // left 用视口坐标 —— 在我们 fixed 的标签面板里必然错位到左下角压住 UP 面板，
  // 且回滚监听挂在 window.scroll（我们页面不滚）→ 永远不会自动还原。
  // 对策：实例级补丁 —— "搬走"不执行（评论框留在列表顶部），"还原"保持原语义。
  function revertHeaderBox(hr) {
    try {
      if (hr && typeof hr.revertTeleportCommentbox === 'function') hr.revertTeleportCommentbox();
    } catch (e) { /* ignore */ }
    try { if (hr) hr.revertTeleportCommentbox = null; } catch (e) { /* ignore */ }
  }

  function patchHeaderBox(hr) {
    if (!hr) return;
    if (hr.__btvBoxPatched) { revertHeaderBox(hr); return; }
    let orig = null;
    try { orig = hr.teleportCommentbox; } catch (e) { orig = null; }
    if (typeof orig !== 'function') return;
    try {
      hr.__btvBoxPatched = true;
      hr.teleportCommentbox = function (restore) {
        if (!enabled) {                       // 脚本停用（宽屏模式等）→ 完全透传原生行为
          try { orig.call(this, restore); } catch (e) { /* ignore */ }
          return;
        }
        if (restore) { revertHeaderBox(this); return; }   // 还原：保持 B 站原语义
        // 搬走：不执行 —— 评论框留在评论列表顶部，滚回顶部就在
      };
    } catch (e) { /* ignore */ }
    revertHeaderBox(hr);                      // 补丁前已被搬走的情况：立即还原
  }

  // 兜底：万一 wrapper 仍然出现（组件重建竞态 / 补丁没打上），
  // 把它重锚到评论面板底部，保证绝不压住 UP 面板
  function anchorFloatWrapper(w) {
    if (!w || !w.isConnected) return;
    try {
      w.style.setProperty('position', 'fixed', 'important');
      w.style.setProperty('left', 'var(--btv-l, 0px)', 'important');
      w.style.setProperty('width', 'var(--btv-w, 0px)', 'important');
      w.style.setProperty('bottom', 'var(--btv-ab, 0px)', 'important');
      w.style.setProperty('z-index', '3', 'important');
    } catch (e) { /* ignore */ }
  }

  // ---------- 评论框默认折叠 + 排序栏右侧展开入口（v3.7 新增 M） ----------
  let boxCollapsed = true;       // 自己的评论框默认收起
  let lastBoxHr = null;         // header 组件实例标记：换了实例（换视频/重建）→ 折叠态复位
  const BOX_BTN_ID = 'btv-cbox-toggle';
  const BOX_SEP_ID = 'btv-cbox-sep';   // 「最新|发表评论」的同款分隔符

  // 跨 shadowRoot 找输入框（bili-comment-box-renderer 的 textarea 在自己的 shadow 里）
  function deepFindTextarea(root) {
    const queue = [];
    if (root && root.shadowRoot) queue.push(root.shadowRoot);
    if (root) queue.push(root);
    let n = 0;
    while (queue.length && n < 5000) {
      const node = queue.shift();
      let list = null;
      try { list = node.querySelectorAll('*'); } catch (e) { continue; }
      for (let i = 0; i < list.length; i++) {
        const el = list[i];
        n++;
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' && el.type === 'text') return el;
        if (el.shadowRoot) queue.push(el.shadowRoot);
        if (n >= 5000) break;
      }
    }
    return null;
  }

  function boxState(hr) {
    try { return hr.shadowRoot.querySelector('#commentbox'); } catch (e) { return null; }
  }

  // 折叠/展开 #commentbox（B 站自带 transition:height .2s，动画免费）
  function setBoxCollapsed(hr, collapsed) {
    const box = boxState(hr);
    if (!box) return;
    try {
      if (collapsed) {
        // 先锚定当前高度再收 0，让 transition 有起止值
        if (box.getAttribute('data-btv-box') !== 'closed') {
          const h = box.getBoundingClientRect().height;
          if (h > 4) box.style.setProperty('height', h + 'px', 'important');
        }
        box.style.setProperty('height', '0px', 'important');
        box.style.setProperty('overflow', 'hidden', 'important');
        box.setAttribute('data-btv-box', 'closed');
      } else {
        box.setAttribute('data-btv-box', 'open');
        const target = Math.max(120, box.scrollHeight || 180);
        box.style.setProperty('height', target + 'px', 'important');
        box.style.setProperty('overflow', 'hidden', 'important');
        // 高度动画到位后摘掉内联 height/overflow，textarea 自增高不再受限
        setTimeout(() => {
          try {
            if (box.isConnected && !boxCollapsed && box.getAttribute('data-btv-box') === 'open') {
              box.style.removeProperty('height');
              box.style.removeProperty('overflow');
            }
          } catch (e) { /* ignore */ }
        }, 280);
      }
    } catch (e) { /* ignore */ }
  }

  // 与「最热|最新」同款文字按钮规范（来自 sort-actions CSS）：
  // 28px 高、左右 6px、13px 字号，普通色 --text3 / 选中色 --text1，无边框无背景
  function styleBoxBtn(btn, collapsed) {
    if (collapsed) {
      btn.textContent = '发表评论';
      btn.style.cssText = 'height:28px;padding:0 6px;font-size:13px;font-family:inherit;' +
        'color:var(--text3);background:none;border:none;cursor:pointer;' +
        'white-space:nowrap;outline:none;';
    } else {
      btn.textContent = '收起';
      btn.style.cssText = 'height:28px;padding:0 6px;font-size:13px;font-family:inherit;' +
        'color:var(--text1);background:none;border:none;cursor:pointer;' +
        'white-space:nowrap;outline:none;';
    }
  }

  function ensureBoxToggle(hr) {
    if (!hr) return;
    let sr = null;
    try { sr = hr.shadowRoot; } catch (e) { sr = null; }
    if (!sr) return;
    let navbar = null, btn = null, sep = null;
    try {
      navbar = sr.querySelector('#navbar');
      btn = sr.querySelector('#' + BOX_BTN_ID);
      sep = sr.querySelector('#' + BOX_SEP_ID);
    } catch (e) { /* ignore */ }
    if (!navbar) return;
    let sort = null;
    try {
      sort = navbar.querySelector('#sort-actions') || navbar.querySelector('#sort-title');
    } catch (e) { sort = null; }
    if (btn && btn.isConnected && btn.__btvHr === hr) {
      // 已在位：核对位置（应紧跟排序区：sort | 分隔符 | 按钮）与样式版本（v3.7.1 迁移）
      const posOK = !sort || (sep && sep.isConnected && sep.previousElementSibling === sort
        && btn.previousElementSibling === sep);
      if (posOK && btn.__btvStyle === 2) {
        // 核对折叠态标记（组件重建 #commentbox 后会丢内联样式）
        const box = boxState(hr);
        if (box && box.getAttribute('data-btv-box') !== (boxCollapsed ? 'closed' : 'open')) {
          setBoxCollapsed(hr, boxCollapsed);
          styleBoxBtn(btn, boxCollapsed);
        }
        return;
      }
      try { if (sep && sep.isConnected) sep.remove(); } catch (e) { /* ignore */ }
      try { btn.remove(); } catch (e) { /* ignore */ }   // 旧位置/旧样式 → 重建归位
      btn = null;
    }
    if (hr !== lastBoxHr) { boxCollapsed = true; lastBoxHr = hr; }   // 新实例 → 复位默认收起
    btn = document.createElement('button');
    btn.id = BOX_BTN_ID;
    btn.type = 'button';
    btn.__btvHr = hr;
    btn.__btvStyle = 2;
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      boxCollapsed = !boxCollapsed;
      setBoxCollapsed(hr, boxCollapsed);
      styleBoxBtn(btn, boxCollapsed);
      if (!boxCollapsed) {
        // 展开后聚焦输入框（等高度动画走完一点点再聚焦，避免视口跳动）
        setTimeout(() => {
          const ta = deepFindTextarea(hr);
          try { if (ta) ta.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }, 120);
      }
    });
    styleBoxBtn(btn, boxCollapsed);
    try {
      if (sort) {
        // 紧跟「最新」：同款 | 分隔符 + 文字按钮（v3.7.1，分隔符规范 = sort-div）
        sep = document.createElement('div');
        sep.id = BOX_SEP_ID;
        sep.style.cssText = 'display:inline-block;height:11px;margin:0 3px;' +
          'border-left:solid 1px var(--text3);vertical-align:-2px;';
        sort.after(sep, btn);
      } else {
        // 无排序区（单模式/风控回落）：沿用贴行尾方案
        const more = navbar.querySelector('#more');
        if (more) {
          navbar.insertBefore(btn, more);                       // 插在 ⋮ 菜单左边
          more.style.setProperty('margin-left', '12px', 'important'); // 抵消原生 auto，避免平分空隙
        } else {
          navbar.appendChild(btn);                              // 无 ⋮ 菜单 → 自己靠右
        }
        btn.style.marginLeft = 'auto';
      }
    } catch (e) { /* ignore */ }
    setBoxCollapsed(hr, boxCollapsed);
  }

  // 停用脚本时还原 B 站原状：移除按钮、清掉内联样式
  function resetHeaderBoxUI() {
    let app = null;
    try { app = $('#commentapp'); } catch (e) { return; }
    if (!app || !app.isConnected) return;
    const found = deepCollect(app, 20000);
    (found.boxes || []).forEach(hr => {
      let sr = null;
      try { sr = hr && hr.shadowRoot; } catch (e) { sr = null; }
      if (!sr) return;
      try {
        const box = sr.querySelector('#commentbox');
        if (box) {
          box.style.removeProperty('height');
          box.style.removeProperty('overflow');
          box.removeAttribute('data-btv-box');
        }
        const btn = sr.querySelector('#' + BOX_BTN_ID);
        if (btn) btn.remove();
        const sepEl = sr.querySelector('#' + BOX_SEP_ID);
        if (sepEl) sepEl.remove();
        // v4.1.0 遗留在评论头部 shadow 里的字号 +/− 组与回顶按钮（v4.1.1 起工具
        // 已移到标签条上，这两行只为清掉热更新前的残留，正常情况恒为 null）
        const fsStack = sr.querySelector('#btv-fs-stack');
        if (fsStack) fsStack.remove();
        const topBtn = sr.querySelector('#btv-top');
        if (topBtn) topBtn.remove();
        const more = sr.querySelector('#more');
        if (more) more.style.removeProperty('margin-left');
        // v3.8 Q/P 还原：评论列表留白 + 头像左偏移
        const nb = sr.querySelector('#navbar');
        if (nb) nb.style.removeProperty('margin-bottom');
        const ct = headerSibling(hr, '#contents');
        if (ct) ct.style.removeProperty('padding-top');
      } catch (e) { /* ignore */ }
    });
    (found.avatars || []).forEach(av => {
      try { av.style.removeProperty('left'); } catch (e) { /* ignore */ }
    });
    (found.bodies || []).forEach(bd => {
      try { bd.style.removeProperty('padding-top'); } catch (e) { /* ignore */ }
    });
    // v4.1 V：还原正文 bili-rich-text 与用户名的字号样式
    (found.riches || []).forEach(rt => {
      try {
        const st = rt.shadowRoot && rt.shadowRoot.querySelector('style[data-btv-shadow]');
        if (st) st.remove();
      } catch (e) { /* ignore */ }
    });
    (found.infos || []).forEach(uf => {
      try {
        const st = uf.shadowRoot && uf.shadowRoot.querySelector('style[data-btv-shadow]');
        if (st) st.remove();
      } catch (e) { /* ignore */ }
    });
    lastBoxHr = null;
  }

  // v3.8 Q：「最热|最新」行到第一条评论之间的留白收紧。
  // 原生 = #navbar margin-bottom 22px + #contents padding-top 14px（36px 空白），
  // 收敛为 6px + 4px。内联样式每 tick 幂等重打（组件重建自动补回），
  // 还原走 resetHeaderBoxUI（removeProperty 即回到样式表原生值）。
  function tightenHeaderGap(hr) {
    try {
      const sr = hr && hr.shadowRoot;
      if (!sr) return;
      const nb = sr.querySelector('#navbar');
      if (nb) nb.style.setProperty('margin-bottom', '4px', 'important');
      // 注意：评论列表容器 #contents 挂在 ***父级*** shadow root（bili-comments）
      // 上，与本头部渲染器同级——在 hr.shadowRoot 里查是查不到的（实测 null，
      // 之前那版就因此只改了 navbar 的 margin）。
      const ct = headerSibling(hr, '#contents');
      if (ct) ct.style.setProperty('padding-top', '0px', 'important');
    } catch (e) { /* ignore */ }
  }

  // 取与头部渲染器同级的节点（bili-comments 的 shadow root 上）
  function headerSibling(hr, sel) {
    try {
      const proot = hr && hr.getRootNode ? hr.getRootNode() : null;
      return (proot && proot.querySelector) ? proot.querySelector(sel) : null;
    } catch (e) { return null; }
  }

  // ---------- v4.1 V/W：评论工具（字号 +/−、回顶 ↑） ----------
  // v4.1.1：落点从「评论头部 shadow 内的 #navbar（"评"左"论"右）」改为「标签条
  // #btv-tab-header 里「评论」标签的左右两侧」—— 挂在我们自己的 DOM 上，随标签 UI
  // 一起创建/隐藏/卸载，既不受 B 站组件重建影响，也不再占用评论标题行的横向空间。
  // 字号倍率 --btv-cfs 写在 <html> 上，四处生效（详见 CSS 注释）：面板级继承、
  // 正文 bili-rich-text 逐实例注入、用户名 user-info 逐实例注入、时间节点内联 calc。
  const CFS_MIN = 0.8, CFS_MAX = 1.6;
  let cfsScale = 1;
  let cfsFlashTimer = 0;

  function loadCfs() {
    try {
      const v = parseFloat(localStorage.getItem(CFS_KEY));
      if (isFinite(v)) cfsScale = Math.min(CFS_MAX, Math.max(CFS_MIN, Math.round(v * 10) / 10));
    } catch (e) { /* ignore */ }
  }
  function applyCfs() { setVars([['--btv-cfs', String(cfsScale)]]); }

  // 按钮状态与当前倍率同步：tooltip 百分比 + 到边界置灰（.off）
  function refreshCmtTools() {
    const pct = Math.round(cfsScale * 100) + '%';
    const inc = $('#btv-cmt-inc'), dec = $('#btv-cmt-dec');
    if (inc) {
      inc.title = '增大评论字体（当前 ' + pct + '）';
      inc.classList.toggle('off', cfsScale >= CFS_MAX - 1e-6);
    }
    if (dec) {
      dec.title = '减小评论字体（当前 ' + pct + '）';
      dec.classList.toggle('off', cfsScale <= CFS_MIN + 1e-6);
    }
    if (cmtFs) cmtFs.title = '评论字号 ' + pct + '（+ 增大 / − 减小）';
  }

  function stepCfs(dir) {
    const next = Math.min(CFS_MAX, Math.max(CFS_MIN, Math.round((cfsScale + dir) * 10) / 10));
    if (next !== cfsScale) {
      cfsScale = next;
      try { localStorage.setItem(CFS_KEY, String(cfsScale)); } catch (e) { /* ignore */ }
      applyCfs();
      flashCfs();                                      // 到边界不动，但点击仍有百分比反馈
    }
    refreshCmtTools();
  }

  // 点击后把当前倍率短暂显示在 + 按钮上（900ms 后还原为 +），给用户"按了多少"的即时反馈
  function flashCfs() {
    const inc = $('#btv-cmt-inc');
    if (!inc) return;
    clearTimeout(cfsFlashTimer);
    inc.textContent = Math.round(cfsScale * 100) + '%';
    inc.style.fontSize = '10px';
    cfsFlashTimer = setTimeout(() => {
      inc.textContent = '+';
      inc.style.fontSize = '';
    }, 900);
  }

  // 小工具按钮（样式在 CSS 的 .btv-cmt-tool；font-family 必须 inherit —— v3.7.1 教训）
  function mkCmtTool(id, text, title) {
    const b = document.createElement('button');
    b.id = id;
    b.type = 'button';
    b.className = 'btv-cmt-tool';
    b.textContent = text;
    b.title = title;
    return b;
  }

  // 字号 +/− 竖排小按钮组（+ 在上、− 在下，总高 17×2+2=36px 与标签按钮同高）
  function buildCmtFs() {
    const box = document.createElement('div');
    box.id = 'btv-cmt-fs';
    const inc = mkCmtTool('btv-cmt-inc', '+', '增大评论字体');
    const dec = mkCmtTool('btv-cmt-dec', '−', '减小评论字体');
    inc.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      stepCfs(0.1);
    });
    dec.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      stepCfs(-0.1);
    });
    box.appendChild(inc);
    box.appendChild(dec);
    return box;
  }

  // 回顶 ↑（评论面板自身是滚动容器 = 槽位 A）
  function buildCmtTop() {
    const b = mkCmtTool('btv-cmt-top', '↑', '回到评论顶部');
    b.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      scrollCommentsTop();
    });
    return b;
  }

  // 回到评论顶部：不在「评论」标签时先切过去再滚 —— 隐藏态下 #commentapp 是
  // 0×0 盒（fixed + left:-99999px），只滚它没有任何可见效果；切换后等一帧让
  // 面板拿到真实尺寸，再平滑滚回顶部（无 scrollTo 的老浏览器降级 scrollTop=0）。
  function scrollCommentsTop() {
    const app = $('#commentapp');
    if (!app) return;
    const go = function () {
      try {
        if (typeof app.scrollTo === 'function') app.scrollTo({ top: 0, behavior: 'smooth' });
        else app.scrollTop = 0;
      } catch (e) { try { app.scrollTop = 0; } catch (e2) { /* ignore */ } }
    };
    if (currentTab === 'comments') { go(); return; }
    activate('comments');
    setTimeout(go, 80);
  }

  // v4.1.1 兜底：清掉 v4.1.0 注入在评论头部 shadow 里的旧工具按钮（旧代码写进
  // 已在渲染的页面时残留），每个实例只做一次；新版工具挂在我们自己的标签条上。
  function dropLegacyCmtTools(hr) {
    try {
      if (!hr || hr.__btvLegacyToolsCleaned) return;
      const sr = hr.shadowRoot;
      if (!sr) return;
      const a = sr.querySelector('#btv-fs-stack');
      if (a) a.remove();
      const b = sr.querySelector('#btv-top');
      if (b) b.remove();
      hr.__btvLegacyToolsCleaned = true;
    } catch (e) { /* ignore */ }
  }

  // v4.1 V：正文 bili-rich-text 逐实例注入字号样式（shadow 内显式 16px/26px 挡住继承，
  // 唯一入口是它自己的 shadowRoot；--btv-cfs 是 custom property，可穿透 shadow 边界。
  // 三段式 = v41c C2 实测口径：16px→22.4px（倍率 1.4）、行高 26→35.84px）
  const RICH_CSS = ':host{font-size:calc(16px * var(--btv-cfs, 1)) !important;}' +
    '#contents{font-size:inherit !important;line-height:1.6 !important;}' +
    '#contents *{font-size:inherit !important;line-height:inherit !important;}';
  function applyRichFonts(list) {
    (list || []).forEach(rt => {
      try { if (rt.shadowRoot) shadowStyle(rt.shadowRoot, RICH_CSS); } catch (e) { /* ignore */ }
    });
  }

  // v4.1 V2e：用户名 #user-name 是显式 14px/21px（不吃面板继承），按倍率单独缩放；
  // 倍率 1 时与原生等值（v41_uname 实测：host 12 继承 / #user-name 14 / a 跟随）
  const USER_CSS = '#user-name, #user-name a { font-size: calc(14px * var(--btv-cfs, 1)) !important; }';
  function applyUserFonts(list) {
    (list || []).forEach(uf => {
      try { if (uf.shadowRoot) shadowStyle(uf.shadowRoot, USER_CSS); } catch (e) { /* ignore */ }
    });
  }

  // ---------- 请求 G：评论分页续载（v4.0 U） ----------
  // B 站 bili-comments 的"加载更多"在 addLoadEvent() 里挂（首屏渲染前调用，
  // .trigger 哨兵还不存在 → 走兜底分支）：监听 (scrollContainer || window)
  // 的 scroll，快到底（scrollTop + 2×clientH ≥ scrollH）时 getList()。
  // scrollContainer 只在「组件连接那一刻 #commentapp 已是 overflow-y:auto/
  // scroll」时才非空；我们版式里 bili-comments 连接早于切到评论 tab
  // （那时 #commentapp 是隐藏盒、无 overflow-y）→ scrollContainer=null →
  // 监听落到 window —— 我们的页面不滚，翻页永不触发（实测确认）。
  // 对策：自己把同款监听挂到 #commentapp 上（WeakSet 去重，每实例只挂一次）。
  const cmtScrollHooked = new WeakSet();

  // ---------- v4.2.2：评论区脏标记（性能） ----------
  // 原实现每秒无条件做一次 ≤2 万节点的 BFS（deepCollect）——即使评论区一个字
  // 都没变、甚至评论 tab 根本没开。改为：MutationObserver 挂在 #commentapp 与
  // BFS 发现的每个 shadowRoot 上（WeakSet 去重，断开的 root 由 GC 自然回收），
  // 回调只置 flag 不做任何重活；tick 时树没变就跳过深度遍历，30 tick 兜底一次
  // 防 observer 漏网（shadowRoot 整棵替换等边界）。最坏情况（B 站持续打
  // mutation，如点赞动画）与旧行为持平，静止时几乎零开销。
  let cmtDirty = true;                    // 首次必须全量
  let lastCmtApp = null;                  // #commentapp 被 Vue 整个换掉时直接置脏
  const cmtObserved = new WeakSet();
  const cmtMO = new MutationObserver(function () { cmtDirty = true; });
  function observeCmtRoot(node) {
    if (!node || cmtObserved.has(node)) return;
    try {
      cmtObserved.add(node);
      cmtMO.observe(node, { childList: true, subtree: true });
    } catch (e) { /* ignore */ }
  }

  function hookCommentPagination() {
    const app = $('#commentapp');
    if (!app || !app.isConnected || cmtScrollHooked.has(app)) return;
    cmtScrollHooked.add(app);
    let lastTry = 0;
    app.addEventListener('scroll', () => {
      const now = Date.now();
      if (now - lastTry < 200) return; // 对齐原生 throttle(100) 量级的节流
      lastTry = now;
      try {
        // 只有评论 tab 激活（面板真正可滚）时才管
        if (!app.classList.contains('btv-a')) return;
        if (Math.ceil(app.scrollTop) + app.clientHeight * 2 < app.scrollHeight) return;
        const bc = app.querySelector('bili-comments');
        if (!bc) return;
        // 与原生兜底分支一致的守卫：结束态不拉、加载中不重入
        if (bc.showEnd || bc.showSpinner || bc.showContinuations) return;
        if (typeof bc.getList === 'function') bc.getList();
      } catch (e) { /* 组件内部状态不可读时静默跳过 */ }
    }, { passive: true });
  }

  function applyCommentTweaks() {
    try {
      const app = $('#commentapp');
      if (!app || !app.isConnected) return;
      cmtTick++;
      // ---- 0.4 分页续载钩子（v4.0 U）：不依赖测量，隐藏态也要挂上（廉价，每 tick 保持）----
      hookCommentPagination();
      // ---- v4.2.2 脏标记：树没变就跳过 ≤2 万节点 BFS（30 tick 兜底一次）----
      // #commentapp 被 Vue 整棵换掉时 observer 挂在旧实例上收不到事件 → 直接置脏。
      if (app !== lastCmtApp) { lastCmtApp = app; cmtDirty = true; }
      if (!cmtDirty && (cmtTick % 30 !== 0)) return;
      const found = deepCollect(app, 20000);
      cmtDirty = false;                  // 消费掉；之后我们/ B 站的改动会经 observer 再置位
      if (enabled && found.boxes.length) {
        // ---- 0. 评论框吸底传送拦截（先还原，再兜底重锚漏网 wrapper）----
        found.boxes.forEach(patchHeaderBox);
        // ---- 0.5 评论框默认折叠 + 排序栏右侧展开入口（v3.7 M / v3.7.1 M2）----
        found.boxes.forEach(ensureBoxToggle);
        // ---- 0.6 「最热|最新」行到首条评论的留白收紧（v3.8 Q）----
        found.boxes.forEach(tightenHeaderGap);
        // ---- 0.65 v4.1.1：清理旧版（v4.1.0）注入在评论头部 shadow 里的 V/W 工具
        //      节点（页面未刷新就热更新脚本时残留）。新版工具挂在标签条
        //      #btv-tab-header 上（我们自己的 DOM），不需要在这里维持 ----
        found.boxes.forEach(dropLegacyCmtTools);
      }
      if (enabled && found.floats.length) found.floats.forEach(anchorFloatWrapper);
      // ---- 0.68 v4.1 V：正文 bili-rich-text 逐实例注入字号倍率样式 ----
      if (enabled && found.riches.length) applyRichFonts(found.riches);
      // ---- 0.69 v4.1 V：用户名（显式 14px）逐实例注入字号倍率样式 ----
      if (enabled && found.infos.length) applyUserFonts(found.infos);
      // ---- 0.7 v3.9 修复：面板没有实际尺寸时不做"测量驱动"的卡片改动 ----
      // 切到别的 tab 时 #commentapp 是 0×0 的隐藏盒（fixed + left:-99999px +
      // width/height:0），但里面的元素仍各自有尺寸并被压扁（实测名字 49px、正文
      // 宽 0）—— getBoundingClientRect 全失真。tweakOneCard 是"测量驱动"的：
      // 一旦测出"时间不在名字旁边"就会依次试策略、都失败即判定 placed='none'，
      // 于是还原时间到原位（正文下方）并打上 data-btv-act='skip' **永久跳过**。
      // 结果就是：切到视频 tab 再切回评论，一级评论的时间永远掉在正文下面。
      // 所以这里先测面板自身尺寸，不可用就只保留上面那些不依赖测量的幂等改动。
      const ar = app.getBoundingClientRect();
      if (!(ar.width > 1 && ar.height > 1)) return;
      if (!found.acts.length) return;
      found.acts.forEach(act => tweakOneCard(act, found.infos));
    } catch (e) { /* 评论组件结构调整时静默跳过，不影响主流程 */ }
  }

  // 单张评论卡片：时间搬到用户名之后 + 操作按钮靠右（幂等，可每秒重复调用）
  function tweakOneCard(act, infos) {
    const asr = act.shadowRoot;
    // 自检失败过的卡片平时不再碰；每 30 tick 给它一次"复活"复检的机会 ——
    // 组件重建后失败原因可能已消失（v3.9：也用于自愈历史遗留的误标 skip）。
    // 复检失败会原样退回 skip，且 nudge 与撤销在同一次 tick 内完成，不会闪。
    if (act.getAttribute('data-btv-act') === 'skip' && (cmtTick % 30 !== 0)) return;

    // ---- 1. 定位"名字行"：取同一 shadowRoot 内、位于本卡片之前最近的那个用户名节点，
    //         它的直接父容器就是名字行（最小容器，避免误抓外层把正文一起卷进 flex）----
    let root = null;
    try { root = act.getRootNode(); } catch (err) { root = null; }
    let info = null;
    infos.forEach(x => {
      if (!x.isConnected) return;
      try { if (root && x.getRootNode() !== root) return; } catch (err) { return; }
      let d = 0;
      try { d = x.compareDocumentPosition(act); } catch (err) { return; }
      if (!(d & Node.DOCUMENT_POSITION_FOLLOWING)) return;      // 必须在操作行之前
      if (!info) { info = x; return; }
      try { if (info.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING) info = x; } catch (err) { /* ignore */ }
    });
    let head = info && info.parentElement;
    if (!head) {
      // 兜底：沿祖先找 id/class 含 header 的容器
      let p = act.parentElement;
      for (let i = 0; i < 5 && p && !head; i++) {
        try { head = p.querySelector(':scope > [id="header"], :scope > [class*="header"]'); } catch (err) { head = null; }
        p = p.parentElement;
      }
    }
    if (!head) return;

    // 名字行里同时还装着正文/操作行 → 紧凑排版，绝不做 display 改造
    const hasBody = !!(head.querySelector('bili-rich-text') || head.querySelector(ACT_TAG));

    // ---- 2. 把时间搬到用户名之后（head 里已有则跳过，保证幂等）----
    let t = head.querySelector('[data-btv-time]');
    if (!t) {
      t = findTimeNode(asr);
      if (t && !t.__btvHome) { try { t.__btvHome = { p: t.parentNode, n: t.nextSibling }; } catch (err) { /* ignore */ } }
      if (t && t.parentElement !== head) {
        if (info && info.parentElement === head) head.insertBefore(t, info.nextSibling);
        else head.appendChild(t);
      }
    }
    styleHeadRow(head, hasBody);
    if (t) styleTimeNode(t, hasBody);

    // ---- 2b. 位置校验：时间必须落在名字"右侧同一行"。楼中楼是紧凑排版，user-info
    //         可能是块级、名字行容器可能是列方向 flex，光把节点搬进去它会掉到名字
    //         下面一行。所以先测，不达标依次换策略（行内化 user-info → 名字行独占
    //         第一行），都不行则整体还原并跳过该卡片。测量是唯一判据。
    let nudges = null, placed = 'plain';
    if (t && info) {
      const cached = t.getAttribute('data-btv-ok') === '1' && (cmtTick % 10 !== 0);
      if (cached) {
        placed = t.getAttribute('data-btv-placed') || 'plain';
      } else if (timeBesideName(info, t)) {
        placed = 'plain';
      } else {
        const list = [];
        nudgeInfoInline(info, list);
        if (timeBesideName(info, t)) placed = 'info-inline';
        else {
          nudgeFlexRows(head, info, t, list);
          placed = timeBesideName(info, t) ? 'flex-rows' : 'none';
        }
        if (placed === 'none') { undoNudges(list); placed = 'none'; }
        else nudges = list;
      }
      if (placed !== 'none') {
        try {
          t.setAttribute('data-btv-ok', '1');
          t.setAttribute('data-btv-placed', placed);
          act.setAttribute('data-btv-cmt', placed);
        } catch (err) { /* ignore */ }
      }
    }

    // ---- 2c. 楼中楼正文另起一行：紧凑排版里用户名 / 时间 / 正文同在一个容器按行内
    //         流排列，"时间紧跟名字右侧"之后正文就紧贴在时间后面。把正文改成整行盒
    //         让它落到名字行下面，再实测；没落到下一行、或把时间摆放带回原点，就
    //         只撤销这一步（保留时间已经摆好的结果，不做整卡回滚）。----
    if (hasBody && placed !== 'none') {
      const body = bodyNode(head);
      if (body && !bodyOnOwnLine(info, t, body)) {
        const bl = [];
        nudgeBodyOwnLine(head, body, info, bl);
        if (bodyOnOwnLine(info, t, body) && timeBesideName(info, t) && layoutSane(head)) {
          if (bl.length) nudges = (nudges || []).concat(bl);
          try { act.setAttribute('data-btv-body', 'own-line'); } catch (err) { /* ignore */ }
        } else {
          undoNudges(bl);
        }
      }
    }

    // ---- 3. 点赞 / 踩 / 回复 / 更多 靠右 ----
    act.style.setProperty('justify-content', 'flex-end', 'important');
    if (asr) shadowStyle(asr, COMMENT_ACT_CSS);

    // ---- 3b. v3.8 P：头像左缘对齐卡片左缘。原生 #user-avatar 是
    //         absolute left:20px（悬在正文列的 80px 缩进里），改 0 后头像
    //         正对评论标题「评」字；楼中楼同理对齐各自卡片。root 必须是
    //         ShadowRoot（有 host）才动，light DOM 兜底路径不碰。----
    try {
      if (root && root.host) {
        const av = root.querySelector('#body > #user-avatar');
        if (av) av.style.setProperty('left', '0px', 'important');
        // 卡片自身顶部内边距 22px → 12px：头像与首行文字一起上提，
        // 顺带收紧卡与卡之间的节奏（保留 12px 呼吸位）
        const bd = root.querySelector('#body');
        if (bd) bd.style.setProperty('padding-top', '12px', 'important');
      }
    } catch (err) { /* ignore */ }

    // ---- 4. 自检：时间没摆到名字旁边、或正文被挤成一字一行 → 撤销这张卡片的
    //         全部改动（含策略微调）并永久跳过，保证最坏情况也不比原生更差 ----
    if (placed === 'none' || !layoutSane(head)) {
      undoNudges(nudges);
      undoHead(head);
      if (t && t.__btvHome) {
        try {
          const h = t.__btvHome;
          h.p.insertBefore(t, (h.n && h.n.parentNode === h.p) ? h.n : null);
        } catch (err) { /* ignore */ }
      }
      resetTimeNode(t);
      try {
        if (t) { t.removeAttribute('data-btv-ok'); t.removeAttribute('data-btv-placed'); }
      } catch (err) { /* ignore */ }
      act.style.removeProperty('justify-content');
      act.setAttribute('data-btv-act', 'skip');
      act.setAttribute('data-btv-cmt', 'skip');
    } else {
      // v3.9：本次全部通过 → 清掉可能残留的 skip 标记（配合上面的 30-tick 复活）
      try { act.removeAttribute('data-btv-act'); } catch (err) { /* ignore */ }
    }
  }

  // ---------- v4.1 Y：合集列表收起/展开（合集标题右侧） ----------
  // 落点：.video-pod__header > .header-top > .left 的 div.amt（"（1/158）"）之后。
  // 收起 = 给 .video-pod 打 btv-pod-collapsed（.video-pod__body display:none，
  // 实测 pod 349→99px、推荐列表顶边 y=483→233），与原生 .pod-expand-btn 的
  // max-height 切换互不干扰。默认展开，收起态记 localStorage；非合集视频没有
  // .video-pod，自然不显示。Vue 重建后每 tick 自愈（按钮补插、class 补打）。
  function ensurePodToggle() {
    if (!enabled) return;
    let pod = null;
    try { pod = $('.rcmd-tab .video-pod'); } catch (e) { pod = null; }
    if (!pod || !pod.isConnected) return;
    let want = false;
    try { want = localStorage.getItem(POD_KEY) === '1'; } catch (e) { want = false; }
    pod.classList.toggle('btv-pod-collapsed', want);
    let left = null;
    try {
      left = pod.querySelector('.video-pod__header .header-top .left')
        || pod.querySelector('.header-top .left')
        || pod.querySelector('.video-pod__header .left');
    } catch (e) { left = null; }
    if (!left) return;
    let btn = null;
    try { btn = pod.querySelector('#btv-pod-toggle'); } catch (e) { btn = null; }
    if (btn && btn.isConnected && btn.parentElement === left) {
      btn.textContent = want ? '展开' : '收起';
      return;
    }
    try { if (btn) btn.remove(); } catch (e) { /* ignore */ }
    let anchor = null;
    try { anchor = left.querySelector('.amt') || left.querySelector('.title'); } catch (e) { anchor = null; }
    btn = document.createElement('button');
    btn.id = 'btv-pod-toggle';
    btn.type = 'button';
    btn.textContent = want ? '展开' : '收起';
    btn.style.cssText = 'height:24px;line-height:24px;padding:0 10px;margin-left:8px;font-size:12px;' +
      'font-family:inherit;color:var(--text3,#9499a0);background:var(--graph_bg_thin,#f1f2f3);' +
      'border:none;border-radius:4px;cursor:pointer;white-space:nowrap;';
    btn.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      const curPod = $('.rcmd-tab .video-pod');       // 现取现用，防闭包持有旧节点
      if (!curPod) return;
      const c = !curPod.classList.contains('btv-pod-collapsed');
      curPod.classList.toggle('btv-pod-collapsed', c);
      try { localStorage.setItem(POD_KEY, c ? '1' : '0'); } catch (e) { /* ignore */ }
      btn.textContent = c ? '展开' : '收起';
    });
    try { left.insertBefore(btn, anchor ? anchor.nextSibling : null); } catch (e) { left.appendChild(btn); }
  }

  // 停用时还原合集区：移除我们的按钮与收起标记（收起态 CSS 本就 gated 在
  // html.btv-on 上，这里清干净是为了原生视图零残留；重启用时按 localStorage 恢复）
  function resetPodUI() {
    try { const b = $('#btv-pod-toggle'); if (b) b.remove(); } catch (e) { /* ignore */ }
    $$('.video-pod.btv-pod-collapsed').forEach(p => p.classList.remove('btv-pod-collapsed'));
  }

  function scheduleLayout() {
    if (layoutTimer) return;
    layoutTimer = setTimeout(() => { layoutTimer = 0; layout(); }, 80);
  }

  function activate(tab) {
    const valid = TABS.some(t => t.id === tab) ? tab : 'videos';
    currentTab = valid;
    try { localStorage.setItem(STORE_KEY, valid); } catch (e) { /* ignore */ }
    $$('.btv-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.btvTab === valid);
    });
    layout();
  }

  // ---------- 启用 / 停用（宽屏模式等右栏隐藏时） ----------
  function enable() {
    if (!isVideoPage() || !isRightVisible()) return false;
    ensureUI();
    if (uiTabs.hasAttribute('hidden-btv')) uiTabs.removeAttribute('hidden-btv');
    document.documentElement.classList.add('btv-on');
    enabled = true;
    loadCfs();                                            // v4.1 V：恢复字号倍率
    applyCfs();
    try { refreshCmtTools(); } catch (e) { /* ignore */ }  // v4.1.1：按恢复的倍率刷新按钮状态
    let def = 'last';                                     // v4.1 X：默认标签优先于"上次使用"
    try { def = localStorage.getItem(DEF_TAB_KEY) || 'last'; } catch (e) { /* ignore */ }
    let saved = 'videos';
    if (def === 'last') {
      try { saved = localStorage.getItem(STORE_KEY) || 'videos'; } catch (e) { /* ignore */ }
    } else if (TABS.some(t => t.id === def)) {
      saved = def;
    }
    activate(saved);
    return true;
  }

  function disable() {
    enabled = false;
    document.documentElement.classList.remove('btv-on');
    clearSlots();
    retractUpPanel();
    try { resetHeaderBoxUI(); } catch (e) { /* ignore */ }   // 还原评论框折叠与按钮（v3.7 M，含 v4.1 V/W 工具与正文样式）
    try { resetPodUI(); } catch (e) { /* ignore */ }         // v4.1 Y：还原合集区
    try { dropRewardUI(); } catch (e) { /* ignore */ }        // v4.2 Z：移除打赏浮层（含遮罩；
    // 注意不要清 rewardBtn —— 停用只是把标签 UI 加 hidden-btv，DOM 节点还在，下次启用复用）
    setVars([
      ['--btv-ui-l', null], ['--btv-ui-t', null], ['--btv-ui-w', null], ['--btv-ui-h', null],
      ['--btv-l', null], ['--btv-w', null], ['--btv-t', null], ['--btv-h', null],
      ['--btv-bt', null], ['--btv-bh', null], ['--btv-ct', null], ['--btv-cbh', null],
      ['--btv-cfs', null],   // v4.1 V：字号倍率清除，shadow 内 calc 回落到原生值
    ]);
    if (uiTabs) uiTabs.setAttribute('hidden-btv', '');
  }

  // ---------- 主流程 ----------
  function main() {
    injectCSS();
    window.addEventListener('resize', scheduleLayout);
    window.addEventListener('scroll', scheduleLayout, { passive: true });
    // v4.2 Z：Esc 关闭打赏浮层（浮层会反复创建/销毁，监听只挂一次）
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && rewardMask && rewardMask.classList.contains('open')) closeReward();
    });

    // 等待 B 站应用启动完成（hydration 结束）后再做 DOM 写入
    let dclAt = Date.now();
    function tryEnable() {
      // v4.2.2：硬地板 3500 → 1000ms。siteBooted()（window.player / 播放器容器）
      // 已是就绪判据；即便极少数情况下仍过早，1s tick 自愈 + 下方 600ms 补测
      // 也会立即纠正，而"等 3.5s"是每次打开页面都实打实付出的代价。
      const waitedEnough = Date.now() - dclAt > 1000;
      if ((waitedEnough && siteBooted()) || Date.now() - dclAt > 12000) {
        if (!enable()) {
          // 右栏暂不可见（加载中/宽屏）：停用并保持监控
          disable();
        } else {
          // 初次测量可能赶在版式稳定完成前（图片/字体未就位）：
          // 600ms 后补一次 layout，不等 1s tick（快速通道，幂等）。
          setTimeout(() => { try { layout(); } catch (e) { /* ignore */ } }, 600);
        }
        return true;
      }
      return false;
    }

    const bootTimer = setInterval(() => {
      if (tryEnable()) clearInterval(bootTimer);
    }, 100);

    // 周期性自愈：站内跳转、右栏显隐变化、Vue 重建节点后重新套用布局
    let lastURL = location.href;
    setInterval(() => {
      if (!enabled) {
        if (isVideoPage() && isRightVisible() && siteBooted()) {
          dclAt = Date.now() - 4000; // 视为已启动
          enable();
        }
        return;
      }
      if (location.href !== lastURL) {
        lastURL = location.href;
        dclAt = Date.now();
        // SPA 跳转：等新页面启动后重挂
        setTimeout(() => { if (siteBooted()) layout(); else disable(); }, 3000);
      }
      if (!isVideoPage() || !isRightVisible()) { disable(); return; }
      // 元素类名被 Vue 重建后丢失 → 重新套用
      try { layout(); } catch (e) { /* ignore */ }
      // v4.1 Y：合集收起/展开按钮（Vue 重建后自愈）
      try { ensurePodToggle(); } catch (e) { /* ignore */ }
      // 评论组件可能在任意时刻重建 shadow DOM，这里低频复检（不与滚动/缩放绑在一起，避免开销）
      applyCommentTweaks();
    }, 1000);
  }

  if (document.readyState === 'loading') {
    // v4.2.2：样式提前到 document-start 注入 —— 全部规则都有 html.btv-on /
    // #btv-* 前缀 gate，未启用前不产生任何视觉效果，但启用瞬间无需再等样式解析。
    // 注意：极早期 <html> 可能还没解析出来（documentElement 为 null，直接 append
    // 会抛错并炸掉整个初始化），失败就 10ms 轮询重试直到能挂上（幂等）。
    try { injectCSS(); } catch (e) { /* 见上，稍后重试 */ }
    const ivCss = setInterval(() => {
      try { injectCSS(); clearInterval(ivCss); } catch (e) { /* 再试 */ }
    }, 10);
    document.addEventListener('DOMContentLoaded', () => { main(); }, { once: true });
  } else {
    main();
  }
})();
