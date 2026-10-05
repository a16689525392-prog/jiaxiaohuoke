% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>开始与红线</h1>
    <p class="sub">把产品、获客、客户管理、销售、交付、回访和转介绍连成一条线。有人加微信，就登记；客户报名，按节点交付；学员拿证，按规则回访；每周根据数据改一次话术和渠道。</p>
  </div>
</div>

% for text, href, label in hints:
<div class="notice">{{text}} <a href="{{href}}">{{label}} →</a></div>
% end

<section class="card">
  <h2>红线</h2>
  <ul class="redlines">
% for line in red_lines:
    <li>{{line}}</li>
% end
  </ul>
</section>

<section class="card flush">
  <div class="card-head"><h2>启动节奏</h2>
    <span class="muted">从 {{fmt_date(start)}} 算起{{'；开始日期可以在“系统设置”里改' if admin else ''}}</span></div>
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>阶段</th><th>日期</th><th>要完成什么</th><th>去哪里做</th></tr></thead>
    <tbody>
% for stage, day, todo, links in plan:
      <tr class="{{'is-dim' if stage not in repeating and day.isoformat() < today else ''}}">
        <td class="nowrap r-main"><strong>{{stage}}</strong></td>
        <td class="nowrap r-meta">{{'下次 ' if stage in repeating else ''}}{{fmt_date(day.isoformat())}}</td>
        <td class="r-full">{{todo}}</td>
        <td class="nowrap r-meta">
%   for label, href in links:
          <a href="{{href}}">{{label}}</a>&nbsp;
%   end
        </td>
      </tr>
% end
    </tbody>
  </table>
  </div>
</section>

<section class="card flush">
  <div class="card-head"><h2>固定动作</h2></div>
  <div class="table-wrap">
  <table class="table rows guide-routine">
    <thead><tr><th>频率</th><th>做什么</th><th>去哪里做</th></tr></thead>
    <tbody>
      <tr><td class="nowrap r-main"><strong>每天</strong></td><td class="r-full">有人加微信，当天登记：来源、学校或区域、车型、可练车时间、预算、最关心的问题、分级、下次跟进时间。</td><td class="nowrap r-meta"><a href="/customers/new">登记客户</a></td></tr>
      <tr><td class="nowrap r-main"><strong>每天</strong></td><td class="r-full">照名单把“今日待跟进”和“已逾期”处理完；每次沟通结束，写下明确的下次跟进时间。</td><td class="nowrap r-meta"><a href="/">今日</a></td></tr>
      <tr><td class="nowrap r-main"><strong>每天</strong></td><td class="r-full">收工前填当天的曝光，看一眼漏斗：新增微信、真正咨询、进入 A 类、交定金、正式报名。</td><td class="nowrap r-meta"><a href="/data/daily">每日数据</a></td></tr>
      <tr><td class="nowrap r-main"><strong>每天</strong></td><td class="r-full">看交付这一侧：资料没齐的、有考试节点要提醒的、没关闭的投诉或异常。</td><td class="nowrap r-meta"><a href="/students">学员交付</a>&nbsp; <a href="/issues">异常台账</a></td></tr>
      <tr><td class="nowrap r-main"><strong>每周</strong></td><td class="r-full">找三类案例复盘：成交过程完整的、聊了很久没成交的、报名后出现问题的。然后改一次话术和渠道。</td><td class="nowrap r-meta"><a href="/data/weekly">周复盘</a></td></tr>
      <tr><td class="nowrap r-main"><strong>每月</strong></td><td class="r-full">比较各个渠道的有效线索、报名人数、实际成本和后续转介绍，不只看哪个渠道加微信最多。</td><td class="nowrap r-meta"><a href="/data/channels">渠道对比</a></td></tr>
    </tbody>
  </table>
  </div>
</section>

<p class="hint">内容按《驾校业务视频完整文案》整理，文案里的做法未经独立核验；涉及价格、政策和考试安排的内容，以当地要求和正式合同为准。</p>
