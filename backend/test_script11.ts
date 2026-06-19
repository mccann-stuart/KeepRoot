function check3(urlStr: string) {
    const parsedUrl = new URL(urlStr);
    const hasCredentials = parsedUrl.username !== '' || parsedUrl.password !== '' || urlStr.includes('@' + parsedUrl.host);
    console.log(urlStr, hasCredentials);
}
check3('http://user:pass@example.com');
check3('http://admin@example.com');
check3('https://:@example.com');
check3('https://example.com/@user/feed');
check3('http://example.com');
