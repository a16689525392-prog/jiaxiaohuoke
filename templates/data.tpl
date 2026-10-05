% rebase('base.tpl')
% rate = lambda v: ('%.1f%%' % (v * 100)) if v is not None else '—'
<div class="page-head">
  <div>
    <h1>数据复盘</h1>
    <p class="sub">数据不是为了做一个好看的排行榜，而是为了找出客户在哪一步掉下去了。除了曝光要手填，其他数字都来自客户登记和跟进记录。</p>
  </div>
  <div class="actions no-print">{{!include('_scope.tpl')}}</div>
</div>
{{!include('_data_tabs.tpl')}}

<p class="tile-group">今天收工前看一眼</p>
<div class="tiles">
  <a class="tile {{'is-bad' if fc['today'] + fc['overdue'] else ''}}" href="/">
    <span class="tile-label">待清零的跟进</span><span class="tile-value">{{fc['today'] + fc['overdue']}}</span><span class="tile-foot">今日 + 逾期</span></a>
  <a class="tile {{'is-bad' if fc['unscheduled'] else ''}}" href="/customers?follow=none">
    <span class="tile-label">在跟但没排时间</span><span class="tile-value">{{fc['unscheduled']}}</span></a>
  <a class="tile" href="/students">
    <span class="tile-label">交付中的学员</span><span class="tile-value">{{dc['active']}}</span></a>
  <a class="tile {{'is-warn' if dc['docs_missing'] else ''}}" href="/students?flag=docs">
    <span class="tile-label">资料还没齐</span><span class="tile-value">{{dc['docs_missing']}}</span></a>
  <a class="tile {{'is-warn' if dc['exams7'] else ''}}" href="/students?flag=exam">
    <span class="tile-label">7 天内有考试</span><span class="tile-value">{{dc['exams7']}}</span></a>
  <a class="tile {{'is-bad' if issues else ''}}" href="/issues">
    <span class="tile-label">没关闭的投诉或异常</span><span class="tile-value">{{issues}}</span></a>
  <a class="tile {{'is-good' if today_filled else 'is-warn'}}" href="/data/daily">
    <span class="tile-label">今天的曝光</span><span class="tile-value">{{'已填' if today_filled else '没填'}}</span></a>
</div>

<section class="card flush">
  <div class="card-head"><h2>漏斗：客户在哪一步掉下去了</h2><span class="muted">本周 {{week_label}}</span></div>
  <div class="table-wrap">
  <table class="table wide">
    <thead><tr><th>环节</th><th class="right">本周</th><th class="right col-opt">上周</th><th class="right">累计</th><th class="right">本周转化率</th><th class="right col-opt">上周</th><th class="right col-opt">累计</th><th class="right">目标</th><th>掉人了先查什么</th></tr></thead>
    <tbody>
% for key, label, hint in funnel:
%   t = targets.get(key)
%   r = r_this.get(key)
      <tr>
        <td class="nowrap"><strong>{{label}}</strong></td>
        <td class="right num"><strong>{{money(this_week[key])}}</strong></td>
        <td class="right num col-opt">{{money(last_week[key])}}</td>
        <td class="right num">{{money(total[key])}}</td>
%   if key == 'exposure':
        <td class="right faint">—</td><td class="right faint col-opt">—</td><td class="right faint col-opt">—</td><td class="right faint">—</td>
%   else:
        <td class="right num">
%     if r is not None and t is not None and r < t:
          <span class="chip chip-red">{{rate(r)}} 低于目标</span>
%     elif r is not None and t is not None:
          <span class="chip chip-green">{{rate(r)}} 达标</span>
%     else:
          {{rate(r)}}
%     end
        </td>
        <td class="right num col-opt">{{rate(r_last.get(key))}}</td>
        <td class="right num col-opt">{{rate(r_total.get(key))}}</td>
        <td class="right num">{{rate(t) if t is not None else '未设'}}</td>
%   end
        <td class="cell-note">{{hint}}</td>
      </tr>
% end
    </tbody>
  </table>
  </div>
</section>
<p class="hint">转化率 = 本环节 ÷ 上一环节，按每个客户第一次到达该环节的日期统计，按周看趋势。直接正式报名、没有单独交定金的，也计入“交定金”。</p>

% if admin:
<section class="card">
  <h2>我的目标</h2>
  <p class="card-note">先空着，跑满两周后按自己的数据填。填了以后，低于目标的环节会标红。</p>
  <form method="post" action="/data/targets" class="filters">
    <input type="hidden" name="_csrf" value="{{csrf}}">
%   for key, label, hint in funnel:
%     if key != 'exposure':
    <label class="field"><span>{{label}}（%）</span>
      <input type="text" name="t_{{key}}" inputmode="decimal" value="{{('%g' % round(targets[key] * 100, 2)) if key in targets else ''}}" placeholder="例如 5"></label>
%     end
%   end
    <button type="submit" class="btn btn-primary">保存目标</button>
  </form>
</section>
% end

<p class="notice is-blue">看完去哪：掉人最多的那一步，对应的话术在<a href="/scripts">统一话术</a>，案例写进<a href="/data/weekly">周复盘</a>，每周只改一句。</p>
