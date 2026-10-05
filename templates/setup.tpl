% rebase('bare.tpl')
<h1>初始化系统</h1>
<p class="hint">第一次使用，先建管理员账号。之后的成员账号由管理员在“成员账号”里添加。</p>
% for e in errors:
<div class="flash flash-err">{{e}}</div>
% end
<form method="post" action="/setup" class="stack">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <label class="field"><span>初始化口令</span>
    <input type="text" name="code" value="{{f.get('code')}}" placeholder="XXXX-XXXX" autocomplete="off" required>
    <small>安装脚本结束时会显示；也可以在服务器上运行 <code>jiaxiao setup-code</code> 查看。</small></label>
  <label class="field"><span>团队名称（可不填）</span>
    <input type="text" name="team_name" value="{{f.get('team_name')}}" maxlength="20" placeholder="例如：东校区招生组"></label>
  <label class="field"><span>管理员用户名</span>
    <input type="text" name="username" value="{{f.get('username')}}" autocomplete="username" required>
    <small>登录用，2–32 位。</small></label>
  <label class="field"><span>显示名称</span>
    <input type="text" name="display_name" value="{{f.get('display_name')}}" maxlength="20" placeholder="例如：小周"></label>
  <label class="field"><span>密码</span>
    <input type="password" name="password" autocomplete="new-password" minlength="8" required>
    <small>至少 8 位。</small></label>
  <label class="field"><span>再输一次密码</span>
    <input type="password" name="password2" autocomplete="new-password" minlength="8" required></label>
  <button type="submit" class="btn btn-primary btn-block">创建管理员并进入系统</button>
</form>
