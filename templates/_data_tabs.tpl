<nav class="tabs no-print">
% for label, href in tabs:
  <a href="{{href}}" class="{{'on' if href == tab else ''}}">{{label}}</a>
% end
</nav>
