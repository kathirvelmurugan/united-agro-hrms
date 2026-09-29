import urllib.request, json
for url in ['http://127.0.0.1:5050/UA/api/login','http://127.0.0.1:5173/UA/api/login']:
    data=json.dumps({'username':'admin','password':'admin123'}).encode()
    req=urllib.request.Request(url, data=data, headers={'Content-Type':'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            print(url, r.status)
            print(r.read().decode()[:800])
    except Exception as e:
        print(url, 'ERR', e)
        try:
            body = e.read().decode() if hasattr(e,'read') and callable(getattr(e,'read')) else str(e)
            print(body[:800])
            if hasattr(e,'headers'):
                print(dict(e.headers))
        except Exception as ex:
            print('read err', ex)
