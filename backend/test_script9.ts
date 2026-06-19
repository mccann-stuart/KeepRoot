function check(urlStr: string) {
    const parsedUrl = new URL(urlStr);
    const hasAtBeforeHost = urlStr.replace(parsedUrl.hash, '').replace(parsedUrl.search, '').replace(parsedUrl.pathname, '').includes('@');
    console.log(urlStr, hasAtBeforeHost, parsedUrl.username !== '' || parsedUrl.password !== '');
}
check('http://user:pass@example.com');
check('http://admin@example.com');
check('https://:@example.com');
check('https://example.com/@user/feed');
