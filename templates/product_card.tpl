% rebase('base.tpl')
<div class="page-head no-print">
  <div>
    <h1>对客产品卡</h1>
    <p class="sub">截图发给客户，或者复制右边的文字版贴到聊天里。也可以打印成 PDF。</p>
  </div>
  <div class="actions">
    <button type="button" class="btn btn-primary" data-copy="card-text">复制文字版</button>
    <button type="button" class="btn" data-print>打印 / 存为 PDF</button>
    <a class="btn" href="/products/{{p['id']}}/compare/new">做对比清单</a>
% if admin:
    <a class="btn" href="/products/{{p['id']}}/edit">编辑</a>
% end
  </div>
</div>

% if pending:
<div class="notice is-red no-print">这张卡还有 {{pending}} 项没核实，卡片上会显示“{{PENDING}}”。核实清楚再发给客户。
%   if admin:
  <a href="/products/{{p['id']}}/edit">去核实 →</a>
%   end
</div>
% end

<div class="split">
  <div>
    <article class="pcard">
      <header class="pcard-head">
        <h2>{{p['name'] or '未命名班型'}}</h2>
        <p>{{p['vehicle'] or '车型待补充'}}　｜　<span>{{p['school'] or PENDING}}</span></p>
      </header>
      <div class="pcard-who"><strong>适合谁：</strong>{{p['who'] or '待补充'}}</div>
      <dl>
% for section, rows in layout:
        <div class="pcard-sec">{{section}}</div>
%   for label, keys, fallback in rows:
%     value = card_value(p, keys, fallback)
        <div class="pcard-row">
          <dt>{{label}}</dt>
          <dd class="{{'pcard-fee' if keys == ['fee'] and is_number(p['fee']) else ''}} {{'pending' if PENDING in value or value == '待补充' else ''}}">{{value}}</dd>
        </div>
%   end
% end
        <div class="pcard-sec is-amber">报名前请知悉</div>
        <div class="pcard-row"><dt>我们不承诺</dt><dd><strong class="due-over">{{consts.NO_PROMISE}}。</strong></dd></div>
        <div class="pcard-row"><dt>报名方式</dt><dd>{{consts.HOW_TO_ENROLL}}</dd></div>
      </dl>
      <footer class="pcard-foot">信息核验日期：{{p['verified_on'] or '待核验'}}　｜　以正式合同和当前合作协议为准</footer>
    </article>
  </div>

  <div class="no-print">
    <section class="card">
      <div class="card-head"><h2>文字版</h2><button type="button" class="btn btn-sm" data-copy="card-text">复制</button></div>
      <div class="script-body" id="card-text">{{text}}</div>
    </section>
    <section class="card">
      <div class="card-head"><h2>对比清单</h2><a class="btn btn-sm" href="/products/{{p['id']}}/compare/new">新建</a></div>
      <p class="card-note">客户说“别家更便宜”，或者 B 类客户还在比较时用：把对方报价按同样的项目填进来，口径一致了再比。</p>
% if comparisons:
      <ul class="help-list">
%   for c in comparisons:
        <li><a href="/compare/{{c['id']}}">{{c['title'] or '对比清单'}}</a> <small>{{fmt_dt(c['updated_at'])}}</small></li>
%   end
      </ul>
% else:
      <p class="muted">还没有做过对比清单。</p>
% end
    </section>
  </div>
</div>
