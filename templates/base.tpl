<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>{{title}}{{' · ' if title else ''}}{{team_name or app_name}}</title>
<link rel="icon" href="/static/favicon.svg">
<link rel="stylesheet" href="/static/app.css?v={{asset_v}}">
</head>
<body data-today="{{today}}">
<div class="shell">
  <aside class="side" id="side">
    <a class="brand" href="/">
      <span class="brand-mark">招</span>
      <span class="brand-text"><strong>{{team_name or '驾校招生'}}</strong><small>业务系统</small></span>
    </a>
    <nav class="nav">
% for label, href, key in nav:
      <a href="{{href}}" class="{{'on' if key == active else ''}}">{{label}}</a>
% end
% if admin:
      <div class="nav-sep">管理</div>
      <a href="/admin/users" class="{{'on' if active == 'admin-users' else ''}}">成员账号</a>
      <a href="/admin/settings" class="{{'on' if active == 'admin-settings' else ''}}">系统设置</a>
      <a href="/admin/export" class="{{'on' if active == 'admin-export' else ''}}">导出与备份</a>
% end
    </nav>
    <div class="side-foot">
      <a href="/account" class="me">{{user['display_name']}}<small>{{'管理员' if admin else '成员'}}</small></a>
      <form method="post" action="/logout">
        <input type="hidden" name="_csrf" value="{{csrf}}">
        <button type="submit" class="side-out">退出</button>
      </form>
    </div>
  </aside>
  <div class="scrim" id="scrim"></div>
  <div class="main">
    <header class="topbar">
      <button type="button" class="menu-btn" id="menu-btn" aria-label="打开菜单"><span></span><span></span><span></span></button>
      <span class="topbar-title">{{title}}</span>
      <a class="topbar-add" href="/customers/new">＋ 客户</a>
    </header>
    <main class="content">
% for kind, msg in flashes:
      <div class="flash flash-{{kind}}" role="status">{{msg}}</div>
% end
{{!body}}
    </main>
  </div>
</div>
<script src="/static/app.js?v={{asset_v}}"></script>
</body>
</html>
