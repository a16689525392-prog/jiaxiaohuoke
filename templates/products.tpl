% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>产品卡</h1>
    <p class="sub">产品卡不是只写报名多少钱的海报，而是让客户看完知道自己买到了什么。金额和政策不确定的地方，保留“{{PENDING}}”，核实后再改。</p>
  </div>
  <div class="actions">
% if admin:
    <a class="btn btn-primary" href="/products/new">＋ 新增班型</a>
% end
  </div>
</div>

% if items:
<div class="grid-3">
%   for p in items:
  <section class="card">
    <div class="card-head">
      <h2><a href="/products/{{p['id']}}">{{p['name'] or '未命名班型'}}</a></h2>
%     if pending[p['id']]:
      <span class="chip chip-amber">{{pending[p['id']]}} 项待核实</span>
%     else:
      <span class="chip chip-green">已核实</span>
%     end
    </div>
    <dl class="kv">
      <dt>车型</dt><dd>{{p['vehicle'] or '—'}}</dd>
      <dt>总费用</dt><dd class="{{'pending' if is_pending(p['fee']) else ''}}"><strong>{{fee_text(p)}}</strong></dd>
      <dt>适合谁</dt><dd>{{p['who'] or '—'}}</dd>
      <dt>已匹配客户</dt><dd>{{counts.get(p['id'], 0)}} 人</dd>
    </dl>
    <div class="form-actions">
      <a class="btn btn-sm btn-primary" href="/products/{{p['id']}}">对客产品卡</a>
      <a class="btn btn-sm" href="/products/{{p['id']}}/compare/new">做对比清单</a>
%     if admin:
      <a class="btn btn-sm" href="/products/{{p['id']}}/edit">编辑</a>
      <form method="post" action="/products/{{p['id']}}/archive" class="inline-form" data-confirm="{{'恢复这个班型？' if p['archived'] else '停用这个班型？已经匹配它的客户和学员不受影响。'}}">
        <input type="hidden" name="_csrf" value="{{csrf}}">
        <button type="submit" class="btn btn-sm">{{'恢复' if p['archived'] else '停用'}}</button>
      </form>
%     end
    </div>
  </section>
%   end
</div>
% else:
<section class="card"><div class="empty"><strong>{{'没有停用的班型' if show_archived else '还没有产品卡'}}</strong>
%   if admin and not show_archived:
  先填第 1 个班型：费用包含什么、不包含什么、钱交给谁、退费转校怎么办。<br><br><a class="btn btn-primary" href="/products/new">填第 1 个班型</a>
%   elif not show_archived:
  请管理员先填第 1 个班型。
%   end
</div></section>
% end

<section class="card">
  <h2>任何班型都不承诺</h2>
  <p><strong class="due-over">包过　｜　免考　｜　最低价　｜　固定拿证天数</strong></p>
  <p class="muted">所有价格、周期、退费、考试和服务内容，按当前合作协议、当地主管部门要求和正式合同核验。</p>
</section>

% if show_archived:
<p><a href="/products">← 回到在用的班型</a></p>
% elif archived_count:
<p><a class="muted" href="/products?archived=1">查看已停用的班型（{{archived_count}}）</a></p>
% end
