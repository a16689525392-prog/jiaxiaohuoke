% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>统一话术</h1>
    <p class="sub">全团队用同一套说法。【】里的内容换成自己的；选一个班型，产品卡里已经核实的内容会自动带进去。每周复盘后只改一句。</p>
  </div>
  <div class="actions">
% if admin:
    <a class="btn btn-primary" href="/scripts/new">＋ 新增话术</a>
% end
  </div>
</div>

<section class="card">
  <h2>销售顺序（稳定下来，不跳步）</h2>
  <ol class="steps">
% for step in order:
    <li>{{step}}</li>
% end
  </ol>
</section>

% if products:
<form method="get" action="/scripts" class="filters no-print">
  <label class="field grow"><span>带入班型</span>
    <select name="product" data-autosubmit>
      <option value="">不带入，保留【】</option>
%   for p in products:
      <option value="{{p['id']}}" {{'selected' if product and product['id'] == p['id'] else ''}}>{{p['name'] or '未命名班型'}} {{p['vehicle']}}</option>
%   end
    </select></label>
  <button type="submit" class="btn">带入</button>
</form>
% end

% for name, items in groups:
<h2 class="tile-group">{{name}}</h2>
%   for s, body in items:
<article class="script">
  <header class="script-head">
    <div><h3>{{s['scene']}}</h3><small>{{s['when_use']}}</small></div>
    <div class="actions">
      <button type="button" class="btn btn-sm btn-primary" data-copy="script-{{s['id']}}">复制</button>
%     if admin:
      <a class="btn btn-sm" href="/scripts/{{s['id']}}/edit">修改</a>
%     end
    </div>
  </header>
  <div class="script-body" id="script-{{s['id']}}">{{body}}</div>
%     if s['tips']:
  <div class="script-tip">{{s['tips']}}</div>
%     end
</article>
%   end
% end

<section class="card flush">
  <div class="card-head"><h2>不能说的话</h2></div>
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>说法</th><th>属于哪一类</th><th>为什么不能说</th><th>换成这样说</th></tr></thead>
    <tbody>
% for say, kind, why, instead in forbidden:
      <tr><td class="nowrap r-main"><strong class="due-over">{{say}}</strong></td><td class="nowrap r-meta">{{kind}}</td><td class="r-full">{{why}}</td><td class="r-full"><span class="r-label">换成：</span>{{instead}}</td></tr>
% end
    </tbody>
  </table>
  </div>
</section>
