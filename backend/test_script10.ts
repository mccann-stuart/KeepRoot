function check2(urlStr: string) {
    try {
        const parsedUrl = new URL(urlStr);
        // The URL constructor parses the authority section into username, password, host, port.
        // If there is an '@' in the authority section that bypasses username/password parsing,
        // it either results in an invalid host (if the parser is strict) or it shows up in parsedUrl.href
        // before the hostname.

        // A robust way to check if there's an '@' in the authority section specifically:
        const authority = urlStr.slice(urlStr.indexOf('//') + 2, urlStr.indexOf('/', urlStr.indexOf('//') + 2) !== -1 ? urlStr.indexOf('/', urlStr.indexOf('//') + 2) : urlStr.length);
        const hasCredentials = authority.includes('@');

        console.log(urlStr, hasCredentials);
    } catch(e) {
        console.log(urlStr, 'invalid');
    }
}
check2('http://user:pass@example.com');
check2('http://admin@example.com');
check2('https://:@example.com');
check2('https://example.com/@user/feed');
check2('http://example.com');
