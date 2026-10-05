% rebase('bare.tpl')
<h1>登录</h1>
% for kind, msg in flashes:
<div class="flash flash-{{kind}}">{{msg}}</div>
% end
% if error:
<div class="flash flash-err">{{error}}</div>
% end
<form method="post" action="/login" class="stack">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <input type="hidden" name="next" value="{{next}}">
  <label class="field"><span>用户名</span>
    <input type="text" name="username" value="{{f.get('username')}}" autocomplete="username" autofocus required></label>
  <label class="field"><span>密码</span>
    <input type="password" name="password" autocomplete="current-password" required></label>
  <button type="submit" class="btn btn-primary btn-block">登录</button>
</form>
<p class="hint">忘记密码请找管理员重置。管理员忘记密码，在服务器上运行 <code>jiaxiao reset-password 用户名</code>。</p>
