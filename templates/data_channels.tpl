% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>渠道对比：{{month_label}}</h1>
    <p class="sub">每月比较各个渠道的有效线索、报名人数、实际成本和后续转介绍，不要只看哪个渠道加微信最多。</p>
  </div>
  <div class="actions no-print">
    {{!include('_scope.tpl')}}
    <span class="seg">
      <a href="/data/channels?month={{prev_month}}">← 上个月</a>
% if next_month:
      <a href="/data/channels?month={{next_month}}">下个月 →</a>
% end
    </span>
  </div>
</div>
{{!include('_data_tabs.tpl')}}

<section class="card flush">
  <div class="table-wrap">
  <table class="table wide">
    <thead><tr><th>渠道</th><th class="right">新增微信</th><th class="right">有效线索（A+B）</th><th class="right">正式报名</th><th class="right col-opt">线索→报名</th>
% if can_costs:
      <th class="right">实际成本</th><th class="right">单个报名成本</th>
% end
      <th class="right">累计带来转介绍</th></tr></thead>
    <tbody>
% for ch, d in rows:
      <tr class="{{'is-dim' if not (d['new'] or d['enrolled'] or d['cost'] or d['referrals']) else ''}}">
        <td class="nowrap"><strong>{{ch['name']}}</strong></td>
        <td class="right num">{{d['new']}}</td>
        <td class="right num">{{d['leads']}}</td>
        <td class="right num">{{d['enrolled']}}</td>
        <td class="right num col-opt">{{pct(d['enrolled'], d['leads']) or '—'}}</td>
%   if can_costs:
        <td class="right num">{{money(d['cost']) if d['cost'] else '0'}}</td>
        <td class="right num">{{money(d['cost'] / d['enrolled']) if d['enrolled'] else '—'}}</td>
%   end
        <td class="right num">{{d['referrals']}}</td>
      </tr>
% end
    </tbody>
    <tfoot>
      <tr><td>合计</td><td class="right num">{{total['new']}}</td><td class="right num">{{total['leads']}}</td>
        <td class="right num">{{total['enrolled']}}</td><td class="right num col-opt">{{pct(total['enrolled'], total['leads']) or '—'}}</td>
% if can_costs:
        <td class="right num">{{money(total['cost']) if total['cost'] else '0'}}</td>
        <td class="right num">{{money(total['cost'] / total['enrolled']) if total['enrolled'] else '—'}}</td>
% end
        <td class="right num">{{total['referrals']}}</td></tr>
    </tfoot>
  </table>
  </div>
</section>
<p class="hint">有效线索 = 当月登记、分级为 A 或 B 的客户；正式报名按报名日期落在当月统计。报名有滞后，“线索→报名”只看趋势。转介绍是累计数：这个渠道来的客户后来一共推荐了多少人。</p>

% if can_costs:
<section class="card">
  <h2>记一笔成本</h2>
  <form method="post" action="/data/costs" class="filters">
    <input type="hidden" name="_csrf" value="{{csrf}}">
    <label class="field"><span>日期</span>
      <input type="date" name="spent_on" value="{{today if first <= today <= last else first}}" required></label>
    <label class="field"><span>渠道</span>
      <select name="channel_id" required>
        <option value="">请选择</option>
%   for ch in channels:
        <option value="{{ch['id']}}">{{ch['name']}}</option>
%   end
      </select></label>
    <label class="field"><span>金额（元）</span>
      <input type="text" name="amount" inputmode="decimal" required></label>
    <label class="field grow"><span>用途</span>
      <input type="text" name="purpose" maxlength="120" placeholder="例如：打印产品卡 50 张、桌牌 1 个"></label>
    <button type="submit" class="btn btn-primary">记一笔</button>
  </form>
</section>

<section class="card flush">
  <div class="card-head"><h2>{{month_label}}的成本记录</h2></div>
%   if costs:
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>日期</th><th>渠道</th><th class="right">金额</th><th>用途</th><th class="col-opt">记录人</th>
%     if admin:
      <th></th>
%     end
    </tr></thead>
    <tbody>
%     for k in costs:
      <tr>
        <td class="nowrap r-meta">{{fmt_date(k['spent_on'])}}</td>
        <td class="r-main"><strong class="sm-only">{{k['channel_name'] or '—'}}</strong><span class="lg-only">{{k['channel_name'] or '—'}}</span></td>
        <td class="right num"><span class="r-label">¥ </span>{{money(k['amount'])}}</td>
        <td class="r-full {{'' if k['purpose'] else 'r-hide'}}">{{k['purpose']}}</td>
        <td class="col-opt r-meta">{{user_name(k['created_by'])}}</td>
%       if admin:
        <td class="tight r-act">
          <form method="post" action="/data/costs/{{k['id']}}/delete" class="inline-form" data-confirm="删除这笔成本？">
            <input type="hidden" name="_csrf" value="{{csrf}}">
            <button type="submit" class="btn btn-sm btn-danger">删除</button>
          </form>
        </td>
%       end
      </tr>
%     end
    </tbody>
  </table>
  </div>
%   else:
  <div class="empty">这个月还没有成本记录。花了钱就记一笔，上面的“实际成本”会自动汇总。</div>
%   end
</section>
% end
