% rebase('base.tpl')
% rv = lambda k: (review[k] if review is not None else '')
% cv = lambda kind, k: (cases[kind][k] if kind in cases else '')
<div class="page-head">
  <div>
    <h1>周复盘</h1>
    <p class="sub">每周找三类案例各一个，然后只改一句话术、调一个渠道。复盘时不要只说“客户太犹豫”，要问清楚客户当时担心什么、你说了什么、对方在哪一步没有继续、下一次准备改哪一句话。</p>
  </div>
  <div class="actions no-print">
    <span class="seg">
      <a href="/data/weekly?week={{prev_week}}">← 上一周</a>
      <a href="/data/weekly" class="{{'on' if is_current else ''}}">本周</a>
% if next_week:
      <a href="/data/weekly?week={{next_week}}">下一周 →</a>
% end
    </span>
  </div>
</div>
{{!include('_data_tabs.tpl')}}

<section class="card">
  <h2>{{fmt_md(week0)}} – {{fmt_md(week1)}} 这一周的数</h2>
  <div class="tiles">
% for key, label, hint in funnel:
%   r = r7.get(key)
    <div class="tile"><span class="tile-label">{{label}}</span><span class="tile-value">{{money(f7[key])}}</span>
      <span class="tile-foot">{{('转化 %.1f%%' % (r * 100)) if r is not None else ' '}}</span></div>
% end
  </div>
</section>

<form method="post" action="/data/weekly?week={{week0}}" class="stack">
  <input type="hidden" name="_csrf" value="{{csrf}}">
% for kind, label in kinds:
  <section class="card">
    <h2>案例 {{kind}}：{{label}}</h2>
    <div class="form-grid">
      <label class="field wide"><span>哪位客户</span>
        <input type="text" name="customer_{{kind}}" value="{{cv(kind, 'customer')}}" maxlength="40"></label>
      <label class="field"><span>客户当时担心什么</span>
        <textarea name="worry_{{kind}}" rows="3" maxlength="800">{{cv(kind, 'worry')}}</textarea></label>
      <label class="field"><span>我说了什么</span>
        <textarea name="said_{{kind}}" rows="3" maxlength="800">{{cv(kind, 'said')}}</textarea></label>
      <label class="field"><span>对方在哪一步没有继续</span>
        <textarea name="stopped_at_{{kind}}" rows="3" maxlength="800">{{cv(kind, 'stopped_at')}}</textarea></label>
      <label class="field"><span>下一次准备改哪一句话</span>
        <textarea name="change_next_{{kind}}" rows="3" maxlength="800">{{cv(kind, 'change_next')}}</textarea></label>
    </div>
  </section>
% end

% if visits:
  <section class="card">
    <h2>这周回访里学员说的</h2>
    <ul class="help-list">
%   for v in visits:
      <li><a href="/students/{{v['id']}}">{{v['name']}}</a>：{{'最麻烦的是“' + clip(v['visit_hard'], 80) + '”' if v['visit_hard'] else ''}}{{'；' if v['visit_hard'] and v['visit_worry'] else ''}}{{'推荐给同学最担心“' + clip(v['visit_worry'], 80) + '”' if v['visit_worry'] else ''}}</li>
%   end
    </ul>
  </section>
% end

  <section class="card">
    <h2>本周结论：只改一处</h2>
    <div class="form-grid">
      <label class="field"><span>掉人最多的环节</span>
        <select name="drop_step">
          <option value="">还没定</option>
% for st in steps:
          <option value="{{st}}" {{'selected' if rv('drop_step') == st else ''}}>{{st}}</option>
% end
        </select></label>
      <label class="check"><input type="checkbox" name="synced" value="1" {{'checked' if review is not None and review['synced'] else ''}}>
        <span class="check-body"><strong>改好的那句话已经同步到统一话术</strong><small>全团队从下周开始用同一个说法。</small></span></label>
      <label class="field"><span>这周话术只改哪一句</span>
        <textarea name="script_change" rows="3" maxlength="600">{{rv('script_change')}}</textarea></label>
      <label class="field"><span>渠道 / 内容怎么调</span>
        <textarea name="channel_change" rows="3" maxlength="600">{{rv('channel_change')}}</textarea></label>
    </div>
  </section>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary">保存本周复盘</button>
    <a class="btn" href="/scripts">去改统一话术</a>
  </div>
</form>
