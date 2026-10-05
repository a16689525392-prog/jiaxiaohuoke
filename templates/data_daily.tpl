% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>每日数据</h1>
    <p class="sub">每天收工前填自己的曝光和实际加了多少微信。登记、咨询、A 类、定金、报名这几个数，系统按客户记录自动算。</p>
  </div>
  <div class="actions no-print">{{!include('_scope.tpl')}}</div>
</div>
{{!include('_data_tabs.tpl')}}

<form method="post" action="{{req.url()}}">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <section class="card flush">
    <div class="table-wrap">
    <table class="table rows">
      <thead><tr>
        <th>日期</th><th>我的曝光</th><th>我加的微信</th><th class="right">已登记</th><th>登记核对</th>
        <th class="right">真正咨询</th><th class="right">进入 A 类</th><th class="right">交定金</th><th class="right">正式报名</th>
        <th>今日小结</th>
      </tr></thead>
      <tbody>
% team = can_all and not mine
% for day in days:
%   a = auto[day]
%   mine_row = my_rows.get(day)
%   exp = mine_row['exposure'] if mine_row and mine_row['exposure'] is not None else ''
%   wx = mine_row['wechat_adds'] if mine_row and mine_row['wechat_adds'] is not None else ''
%   gap = (wx - own[day]['registered']) if wx != '' else None
        <tr class="{{'is-today' if day == today else ''}}">
          <td class="nowrap r-main"><input type="hidden" name="day" value="{{day}}">
            <strong>{{fmt_md(day)}}</strong> <span class="muted">周{{weekdays[to_date(day).weekday()]}}</span>{{'（今天）' if day == today else ''}}</td>
          <td class="r-half"><span class="r-label">我的曝光</span>
            <input type="number" name="exposure_{{day}}" value="{{exp}}" min="0" step="1" inputmode="numeric" aria-label="{{day}} 曝光">
%   if team and a['exposure'] is not None:
            <small class="faint nowrap">全队 {{money(a['exposure'])}}</small>
%   end
          </td>
          <td class="r-half"><span class="r-label">我加的微信</span>
            <input type="number" name="wechat_{{day}}" value="{{wx}}" min="0" step="1" inputmode="numeric" aria-label="{{day}} 加微信">
%   if team and a['wechat_manual'] is not None:
            <small class="faint nowrap">全队 {{money(a['wechat_manual'])}}</small>
%   end
          </td>
          <td class="right num r-meta"><span class="r-label">已登记 </span>{{a['registered']}}</td>
          <td class="nowrap {{'r-hide' if gap is None else ''}}">
%   if gap is None:
            <span class="faint">—</span>
%   elif gap > 0:
            <span class="chip chip-red">少登记 {{gap}} 人</span>
%   elif gap < 0:
            <span class="chip">登记多于手填</span>
%   else:
            <span class="chip chip-green">已对上</span>
%   end
          </td>
          <td class="right num r-meta"><span class="r-label">咨询 </span>{{a['consulted']}}</td>
          <td class="right num r-meta"><span class="r-label">A 类 </span>{{a['grade_a']}}</td>
          <td class="right num r-meta"><span class="r-label">定金 </span>{{a['deposit']}}</td>
          <td class="right num r-meta"><span class="r-label">报名 </span>{{a['enrolled']}}</td>
          <td class="r-full"><input type="text" name="summary_{{day}}" value="{{mine_row['summary'] if mine_row else ''}}" maxlength="500" placeholder="客户在哪一步掉了，明天改什么" aria-label="{{day}} 小结"></td>
        </tr>
% end
      </tbody>
    </table>
    </div>
    <div class="pager">
      <a class="btn btn-sm" href="/data/daily?end={{prev_end}}">← 更早的 14 天</a>
% if next_end:
      <a class="btn btn-sm" href="/data/daily?end={{next_end}}">更近的 14 天 →</a>
% end
      <button type="submit" class="btn btn-primary">保存</button>
    </div>
  </section>
</form>
<p class="hint">“登记核对”拿你手填的加微数，和你当天实际登记到系统里的客户数比：少了就是有人加了微信还没登记。{{'“已登记”到“正式报名”这几列，现在显示的是' + ('你负责的客户。' if mine else '全团队的客户。') if can_all else ''}}</p>
