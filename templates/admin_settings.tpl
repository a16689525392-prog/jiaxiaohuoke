% rebase('base.tpl')
<div class="page-head"><div><h1>系统设置</h1></div></div>
% for e in errors:
<div class="flash flash-err">{{e}}</div>
% end
<form method="post" action="/admin/settings" class="stack">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <section class="card">
    <h2>团队</h2>
    <div class="form-grid">
      <label class="field"><span>团队名称</span>
        <input type="text" name="team_name" value="{{setting('team_name')}}" maxlength="20" placeholder="例如：东校区招生组">
        <small>显示在左上角。</small></label>
      <label class="field"><span>开始日期</span>
        <input type="date" name="start_date" value="{{setting('start_date')}}">
        <small>“开始与红线”里的启动节奏从这一天算起。</small></label>
    </div>
  </section>
  <section class="card">
    <h2>成员能看到什么</h2>
    <label class="check"><input type="checkbox" name="members_only_own" value="1" {{'checked' if setting('members_only_own') == '1' else ''}}>
      <span class="check-body"><strong>成员只能看到自己负责的客户和学员</strong>
        <small>不勾：全团队共享，谁都能看到和接手别人的客户。勾上：成员只看自己名下的，数据页也只算自己的；管理员始终看全部。</small>
        <small>个人信息只收业务必要的，限定负责人和用途。</small></span></label>
% if unassigned:
    <p class="notice">有 {{unassigned}} 个客户没有负责人，勾上以后只有管理员能看到他们。</p>
% end
  </section>
  <div class="form-actions"><button type="submit" class="btn btn-primary">保存设置</button></div>
</form>

<section class="card">
  <h2>运行信息</h2>
  <dl class="kv">
    <dt>版本</dt><dd>{{version}}</dd>
    <dt>系统时间</dt><dd>{{now}}（UTC{{'%+g' % tz}}）</dd>
    <dt>数据目录</dt><dd><code>{{data_dir}}</code></dd>
    <dt>访问范围</dt><dd>{{'已放开：公网地址也能访问' if allow_public else '只接受内网和本机；来自公网地址的访问会被拒绝'}}</dd>
  </dl>
  <p class="hint">“今天”按上面的系统时间算。时区在服务器的环境变量 <code>JX_TZ_OFFSET</code> 里改，默认是 8（北京时间）。系统用的是不加密的 http，只适合在内网使用。</p>
</section>
