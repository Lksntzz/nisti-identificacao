if (location.pathname === '/admin') {
  import('./main.jsx');
} else {
  import('./public-main.jsx');
}
