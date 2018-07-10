koa-file-middle
===============

![npm](https://nodei.co/npm/koa-file-middle.png)

koa中间件，静态文件路由。

如何安装?
--------

```
npm install --save koa-file-middle
```

如何使用?
--------

```Javascript
const koa = require('koa');
const file_router = require('koa-file-middle');

const app = new koa();

app.use(file_router({
    root: '/opt/',
    route: '/',
    // lastmodified: true,
    // maxage: 0,
    // immutable: false,
    // compress: true,
    // showdir: true,
    // extdict: {},
    // page_not_found: ctx=>{}
}));

app.listen(8888);
```

配置说明
------

* root
本地磁盘路径

* route
路由配置

* lastmodified
是否使用Last-Modified属性。默认为false。

* maxage
是否使用缓存机制，单位为秒。大约0秒时，使用Expires，Cache-Control属性。默认为0。

* immutable
是否在Cache-Control中添加immutable属性，默认为false。

* compress
是否使用压缩。默认为false。

* showdir
访问目录时是否列取目录内容。默认false。

* extdict
自定义后缀名返回类型。
```Javascript
app.use(file_router({root: '/opt/', route: '/',
    extdict: {
        '.bin': 'text/html',
    }
}));
```

* page_not_found
自定义访问失败函数。
```Javascript
app.use(file_router({root: '/opt/', route: '/',
    page_not_found: ctx=>{
        ctx.body = 'Page not found';
    }
}));
```

欢迎使用！