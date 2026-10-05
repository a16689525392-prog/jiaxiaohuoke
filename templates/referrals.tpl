% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>转介绍</h1>
    <p class="sub">学员愿意推荐时，先把规则说清楚，并且写在公开的地方。只奖励直接推荐，只讲真实体验。</p>
  </div>
</div>

<div class="grid-2">
  <section class="card">
    <h2>公开规则</h2>
% if admin:
    <form method="post" action="/referrals/rules" class="stack">
      <input type="hidden" name="_csrf" value="{{csrf}}">
%   for key, label, example in rules:
      <label class="field"><span>{{label}}</span>
%     if key == 'reward_amount':
        <input type="text" name="{{key}}" value="{{setting(key)}}" maxlength="12" inputmode="decimal" placeholder="例如：{{example}}">
%     else:
        <textarea name="{{key}}" rows="2" maxlength="300" placeholder="例如：{{example}}">{{setting(key)}}</textarea>
%     end
      </label>
%   end
      <div><button type="submit" class="btn btn-primary">保存规则</button></div>
    </form>
% else:
    <dl class="kv">
%   for key, label, example in rules:
%     if key != 'reward_amount':
      <dt>{{label}}</dt><dd>{{nl2br(setting(key)) if setting(key) else '管理员还没写'}}</dd>
%     end
%   end
    </dl>
% end
    <p class="hint">有效推荐按“被推荐人完成正式报名”统计。</p>
  </section>

  <div>
    <section class="card">
      <h2>红线</h2>
      <ul class="redlines">
% for line in red_lines:
        <li>{{line}}</li>
% end
      </ul>
    </section>
    <section class="card">
      <h2>愿意推荐的学员</h2>
      <p class="card-note">回访时表示愿意推荐的学员。对他们讲清规则，给一段真实、合规、可以核验的<a href="/scripts">分享话术</a>。</p>
% if willing:
      <p>
%   for w in willing:
        <a class="chip chip-green" href="/students/{{w['id']}}">{{w['name']}}</a>
%   end
      </p>
% else:
      <p class="muted">还没有。学员拿证回访时问一句，记在学员页面的“愿意转介绍吗”。</p>
% end
    </section>
  </div>
</div>

<section class="card flush">
  <div class="card-head"><h2>推荐官</h2><span class="muted">登记客户时选了“推荐人”，这里自动汇总</span></div>
% if people:
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>推荐人</th><th class="right">累计推荐</th><th class="right">已正式报名</th><th class="right">应发奖励</th><th class="right">已发</th><th class="right">待发</th><th class="col-opt">最近发放</th></tr></thead>
    <tbody>
%   for x in people:
%     r = x['r']
      <tr>
        <td class="r-main"><a class="name" href="/customers/{{r['id']}}">{{r['name']}}</a></td>
        <td class="right num r-meta"><span class="r-label">推荐 </span>{{r['total']}}</td>
        <td class="right num r-meta"><span class="r-label">已报名 </span>{{x['enrolled']}}</td>
        <td class="right num r-meta"><span class="r-label">应发 </span>{{'—' if x['due'] is None else money(x['due'])}}</td>
        <td class="right num r-meta"><span class="r-label">已发 </span>{{money(r['paid']) if r['paid'] else '0'}}</td>
        <td class="right num"><span class="r-label">待发 </span>
%     if x['left'] is None:
          —
%     elif x['left'] > 0:
          <strong class="due-soon">{{money(x['left'])}}</strong>
%     else:
          {{money(x['left'])}}
%     end
        </td>
        <td class="col-opt r-meta {{'' if r['last_paid'] else 'r-hide'}}"><span class="r-label">最近发放 </span>{{fmt_date(r['last_paid']) or '—'}}</td>
      </tr>
%   end
    </tbody>
  </table>
  </div>
% else:
  <div class="empty"><strong>还没有转介绍</strong>登记客户时在“推荐人”里选上推荐他的学员，这里就会出现。</div>
% end
</section>

% if admin:
<section class="card">
  <h2>记录一笔奖励发放</h2>
%   if not people:
  <p class="muted">有了推荐官以后，在这里记每一笔发放。</p>
%   else:
  <form method="post" action="/referrals/payout" class="filters">
    <input type="hidden" name="_csrf" value="{{csrf}}">
    <label class="field"><span>推荐人</span>
      <select name="referrer_id" required>
%     for x in people:
        <option value="{{x['r']['id']}}">{{x['r']['name']}}</option>
%     end
      </select></label>
    <label class="field"><span>金额（元）</span>
      <input type="text" name="amount" inputmode="decimal" value="{{money(amount) if amount else ''}}" required></label>
    <label class="field"><span>发放日期</span>
      <input type="date" name="paid_on" value="{{today}}" max="{{today}}"></label>
    <label class="field grow"><span>备注</span>
      <input type="text" name="note" maxlength="120" placeholder="例如：推荐郑同学，微信转账"></label>
    <button type="submit" class="btn btn-primary">记录发放</button>
  </form>
%   end
</section>
% end

% if payouts:
<section class="card flush">
  <div class="card-head"><h2>发放记录</h2></div>
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>发放日期</th><th>推荐人</th><th class="right">金额</th><th>备注</th>
%   if admin:
      <th></th>
%   end
    </tr></thead>
    <tbody>
%   for p in payouts:
      <tr>
        <td class="nowrap r-meta">{{fmt_date(p['paid_on'])}}</td>
        <td class="r-main">{{p['referrer_name']}}</td>
        <td class="right num"><span class="r-label">¥ </span>{{money(p['amount'])}}</td>
        <td class="r-full {{'' if p['note'] else 'r-hide'}}">{{p['note']}}</td>
%     if admin:
        <td class="tight r-act">
          <form method="post" action="/referrals/payout/{{p['id']}}/delete" class="inline-form" data-confirm="删除这条发放记录？">
            <input type="hidden" name="_csrf" value="{{csrf}}">
            <button type="submit" class="btn btn-sm btn-danger">删除</button>
          </form>
        </td>
%     end
      </tr>
%   end
    </tbody>
  </table>
  </div>
</section>
% end
