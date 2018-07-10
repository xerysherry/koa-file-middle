const util = require('util');
const fs = require('fs');
const zlib = require('zlib')
const Stream = require('stream')
const iconv = require('iconv-lite')
const {
    normalize,
    extname,
    resolve,
    sep
  } = require('path');

const readdir = util.promisify(fs.readdir);
const exists = util.promisify(fs.exists);
const stat = util.promisify(fs.stat);

const content_encoding_map = 
{
    'text/html': 'gzip',
    'text/css': 'gzip',
    'text/xml': 'gzip',
    'text/plain': 'gzip',
    'image/tiff': "deflate",
    'image/bmp': "deflate",
    'application/x-javascript': 'gzip'
};
const encoding_methods = 
{
    gzip: zlib.createGzip,
    deflate: zlib.createDeflate
};

function HexToNumber(hex) 
{
    var code = 0;
    var char = 0;
    for (var i = 0; i < hex.length; ++i) {
        char = hex.charCodeAt(i);
        if (48 <= char && char <= 57)
            code = code * 0x10 + (char - 48);
        else if (65 <= char && char <= 70)
            code = code * 0x10 + (char - 65 + 10);
        else if (97 <= char && char <= 102)
            code = code * 0x10 + (char - 97 + 10);
    }
    return code;
};

const url_decode_re = /%([0-9A-Fa-f]{2})/g;

function UrlDecode(url) 
{
    let greater_7f = false;
    let nexturl =  url.replace(url_decode_re, function (_, hex) {
        let code = HexToNumber(hex);
        if(code > 0x7f)
            greater_7f = true;
        return String.fromCharCode(code);
    });
    if (greater_7f)
        nexturl = iconv.decode(Buffer.from(nexturl, 'binary'), "utf8");
    return nexturl;
};

function GetReadableSize(size)
{
    if(size < 1024 * 1.5)
        return size + 'B'
    else if(size < 1024 * 1024 * 1.2)
        return Math.floor((size * 10.0 / 1024)) / 10 + 'KB'
    else if(size < 1024 * 1024 * 1024 * 1.2)
        return Math.floor((size * 10.0 / 1024 / 1024)) / 10 + 'MB'
    else
        return Math.floor((size * 10.0 / 1024 / 1024 / 1024)) / 10 + 'GB'
}

async function DirectoryPage(ctx, root, route, dir)
{
    let path = normalize(root + '/' + dir);
    let files = await readdir(path, 'utf8');
    let content = '';
    content += "<html><meta charset='utf-8'><title>";
    content += dir;
    content += "</title><body>";

    content += `<h2>Index of "${sep+dir}"</h2>`
    content += '<table><tbody>'
    if (!(dir == sep || dir == '')) 
    {
        if(dir[dir.length-1] == sep)
            dir = dir.slice(0, dir.length - 1); 
        let index = dir.lastIndexOf(sep);
        if(index < 0)
            index = 0;
        let href = normalize(route + dir.slice(0, index));
        let s = `<tr><td><a id='_d' href='${normalize(href)}'>[..]</a></td><td>Directory</td></tr>`;
        content += s;
    }

    let content_dicts = new Array();
    let content_files = new Array();
    for (let key in files) 
    {
        let name = files[key];
        let href = normalize(dir + '/' + name);
        let p = normalize(root + href);
        let ex = await exists(p);
        if(!ex)
            continue;

        try {
            let stats = fs.statSync(p);
            if (stats == null)
                continue;
            href = normalize(route + href);
            if (stats.isDirectory())
            {
                content_dicts.push('<tr>');
                content_dicts.push(`<td><a id='_f' href='${href}'>[${name}]</a></td>`);
                content_dicts.push('<td></td>');
                content_dicts.push('<td>Directory</td>');
                content_dicts.push('</tr>')
            }
            else
            {
                content_files.push('<tr>');
                content_files.push(`<td><a id='_f' href='${href}'>${name}</a></td>`);
                content_files.push(`<td>${GetReadableSize(stats.size)}</td>`)
                content_files.push(`<td>${stats.mtime.toLocaleDateString()} ${stats.mtime.toLocaleTimeString()}</td>`);
                content_files.push('</tr>')
            }
        }
        catch (e) {
            continue;
        }
    }
    content += content_dicts.join('');
    content += content_files.join('');
    content += '</tbody></table>';
    content += '</body></html>';
    
    ctx.set('Content-Length', content.length);
    ctx.type = "text/html";
    ctx.body = content;
}

async function FilePage(ctx, stats, root, route, dir, lastmodified, maxage, immutable, extdict)
{
    let path = normalize(root + '/' + dir);
    let if_modified_since = ctx.headers['if-modified-since'];
    let lastmodifiedtime = stats.mtime.toUTCString();

    if(lastmodified)
    {
        if(if_modified_since && if_modified_since == lastmodifiedtime)
        {
            ctx.status = 304;
            return;
        }
        ctx.set('Last-Modified', lastmodifiedtime);
    }
    if(maxage > 0)
    {
        let content = 'max-age=' + maxage;
        if(immutable)
            content += ', immutable';
        ctx.set('Expires', new Date(Date.now() + maxage * 1000).toUTCString())
        ctx.set('Cache-Control', content);
    }

    ctx.body = fs.createReadStream(path);
    let ext = extname(dir);
    if(extdict != null)
    {
        let value = extdict[ext];
        if(value != null)
            ext = value;
    }
    ctx.type = ext;
}

function PageNotFound(ctx)
{
    ctx.status = 404;
    ctx.type = 'html';
    ctx.body = '<p>Page Not Found</p>';
}

function Compress(ctx)
{
    let body = ctx.body;
    if(!body)
        return;
    if (ctx.response.get('Content-Encoding')) 
        return;
    var encoding = content_encoding_map[ctx.type];
    if(!encoding)
        return;
    encoding = ctx.acceptsEncodings(encoding);

    ctx.set('Content-Encoding', encoding);
    ctx.res.removeHeader('Content-Length');
    const stream = ctx.body = encoding_methods[encoding]()

    if (body instanceof Stream) 
    {
        body.pipe(stream)
    } 
    else 
    {
        stream.end(body)
    }
}

function file_middleware(conf)
{
    // default: __dirname
    const root = conf.root!=null ? normalize(resolve(conf.root)) : __dirname;
    // default: /
    const route = conf.route!=null ? normalize(conf.route) : sep;
    // default: false
    const lastmodified = conf.lastmodified || false;
    // default: 0
    const maxage = conf.maxage || 0;
    // default: false
    const immutable = conf.immutable || false;
    // default: true
    const compress = conf.compress !== false;
    // default: false
    const showdir = conf.showdir || false;
    // default: null
    const extdict = conf.extdict;
    // default: PageNotFound
    const page_not_found = conf.notfound || PageNotFound;

    return async function(ctx, next) 
    {
        let path = normalize(ctx.path);
        if(path.slice(0,route.length) != route)
        {
            await next();
            return;
        }
        path = path.slice(route.length);
        path = UrlDecode(path);
        //console.log("route %s\n    ->%s", route, path);

        try
        {
            var fullpath = normalize(root + '/' + path);
            var ex = await exists(fullpath);
            if(!ex)
            {
                page_not_found(ctx);
                return;
            }
            let stats = await stat(fullpath);
            if (stats == null)
            {
                page_not_found(ctx);
                return;
            }
            if (stats.isDirectory())
            {
                if(showdir)
                    await DirectoryPage(ctx, root, route, path);
                else
                {
                    page_not_found(ctx);
                    return;
                }
            }
            else
                await FilePage(ctx, stats, root, route, path, lastmodified, maxage, immutable, extdict);
            if(compress)
                Compress(ctx);
        }
        catch(e)
        {
            page_not_found(ctx);
        }
    }
}

module.exports = file_middleware;