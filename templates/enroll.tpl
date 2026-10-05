% rebase('base.tpl')
% fv = lambda k, d='': (f.get(k) if posted else d)
<div class="page-head">
  <div>
    <h1>报名确认：{{c['name']}}</h1>
    <p class="sub">收款之前，先和客户核对四项。任何情况下都不私下收一笔钱，再用“我先帮你占名额”代替正式报名。</p>
  </div>
  <div class="actions"><a class="btn" href="/customers/{{c['id']}}">返回客户</a></div>
</div>

% for e in errors:
<div class="flash flash-err">{{e}}</div>
% end

% if not products:
<div class="notice is-red">还没有产品卡。先去<a href="/products/new">填一个班型</a>，再来办理。</div>
% else:
<form method="get" action="/customers/{{c['id']}}/enroll" class="filters">
  <label class="field grow"><span>班型</span>
    <select name="product" data-autosubmit>
%   for p in products:
      <option value="{{p['id']}}" {{'selected' if product and p['id'] == product['id'] else ''}}>{{p['name'] or '未命名班型'}} {{p['vehicle']}}</option>
%   end
    </select></label>
  <button type="submit" class="btn">换班型</button>
</form>

%   if pending:
<div class="notice is-red">这个班型的产品卡还有 {{pending}} 项没核实。对着合作协议和合同核实清楚，再和客户核对、收款。 <a href="/products/{{product['id']}}/edit">去核实 →</a></div>
%   end

<form method="post" action="/customers/{{c['id']}}/enroll" class="stack">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <input type="hidden" name="product_id" value="{{product['id']}}">

  <section class="card">
    <h2>付款前四项核对</h2>
    <p class="card-note">逐项和客户对一遍，对上了再打勾。</p>
%   for key, label, fields in consts.FOUR_CHECKS:
    <label class="check">
      <input type="checkbox" name="chk_{{key}}" value="1" {{'checked' if fv('chk_' + key) == '1' or (not posted and c['chk4_on']) else ''}}>
      <span class="check-body"><strong>{{label}}</strong>
%     for fk in fields:
        <small><span class="muted">{{consts.PRODUCT_LABELS[fk]}}：</span><span class="{{'pending' if is_pending(product[fk]) else ''}}">{{(money(product[fk]) + ' 元') if fk == 'fee' and is_number(product[fk]) else (product[fk] or PENDING)}}</span></small>
%     end
      </span>
    </label>
%   end
  </section>

  <section class="card">
    <h2>这次办理</h2>
    <div class="stack">
      <div class="radio-row">
        <label><input type="radio" id="act-deposit" name="action" value="deposit" {{'checked' if fv('action') == 'deposit' else ''}}> 收定金</label>
        <label><input type="radio" id="act-enroll" name="action" value="enroll" {{'checked' if fv('action', 'enroll' if c['status'] == '已交定金' else '') == 'enroll' else ''}}> 正式报名</label>
      </div>
      <div class="form-grid">
        <label class="field"><span>办理日期</span>
          <input type="date" name="on" value="{{fv('on', today)}}" max="{{today}}"></label>
      </div>

      <div data-show-when="act-deposit=deposit" class="stack">
        <div class="form-grid">
          <label class="field"><span>下一步动作</span>
            <input type="text" name="dep_next_action" value="{{fv('dep_next_action', '跟进签合同、付清余款')}}" maxlength="120"></label>
          <div class="field"><label for="dep_next_on" class="label">下次跟进时间＊</label>
            <input type="date" id="dep_next_on" name="dep_next_on" value="{{fv('dep_next_on')}}" min="{{today}}">
            <div class="quick-dates">
              <button type="button" data-set-date="dep_next_on" data-days="1">明天</button>
              <button type="button" data-set-date="dep_next_on" data-days="3">3 天后</button>
              <button type="button" data-set-date="dep_next_on" data-days="7">一周后</button>
            </div></div>
        </div>
      </div>

      <div data-show-when="act-deposit=enroll" class="stack">
        <label class="check"><input type="checkbox" name="contract" value="1" {{'checked' if fv('contract') == '1' else ''}}>
          <span class="check-body"><strong>正式合同已签</strong><small>学员签的合同盖的是产品卡上写的那个章。</small></span></label>
        <label class="check"><input type="checkbox" name="receipt" value="1" {{'checked' if fv('receipt') == '1' else ''}}>
          <span class="check-body"><strong>付款凭证已开</strong><small>钱付到合同上的收款主体，没有转给个人。</small></span></label>
        <label class="check"><input type="checkbox" name="doclist" value="1" {{'checked' if fv('doclist') == '1' else ''}}>
          <span class="check-body"><strong>合同和资料清单已发给学员</strong><small>缺什么一次列清，带上截止时间。还没发可以先不勾，进交付清单再做。</small></span></label>
        <label class="check"><input type="checkbox" name="told_owner" value="1" {{'checked' if fv('told_owner') == '1' else ''}}>
          <span class="check-body"><strong>已告诉学员之后有事找谁</strong><small>不能把学员直接丢进一个没有说明的群。</small></span></label>
        <div class="form-grid">
%   if can_all:
          <label class="field"><span>交付负责人</span>
            <select name="owner_id">
%     for u in users:
              <option value="{{u['id']}}" {{'selected' if fv('owner_id', str(user['id'])) == str(u['id']) else ''}}>{{u['display_name']}}{{'' if u['active'] else '（已停用）'}}</option>
%     end
            </select></label>
%   end
          <label class="field"><span>交付的下一步动作</span>
            <input type="text" name="stu_next_action" value="{{fv('stu_next_action', '发资料清单，确认身份证明、照片和体检')}}" maxlength="120"></label>
          <div class="field"><label for="stu_next_on" class="label">下次动作日期＊</label>
            <input type="date" id="stu_next_on" name="stu_next_on" value="{{fv('stu_next_on', today)}}">
            <div class="quick-dates">
              <button type="button" data-set-date="stu_next_on" data-days="0">今天</button>
              <button type="button" data-set-date="stu_next_on" data-days="1">明天</button>
              <button type="button" data-set-date="stu_next_on" data-days="3">3 天后</button>
            </div></div>
        </div>
      </div>
    </div>
  </section>

  <div class="form-actions">
    <button type="submit" class="btn btn-primary">确认办理</button>
    <a class="btn" href="/customers/{{c['id']}}">取消</a>
  </div>
</form>
% end
