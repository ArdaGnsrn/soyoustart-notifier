const fetch = require('node-fetch');
const mysql = require('mysql');
const {Webhook, MessageBuilder} = require('discord-webhook-node');
var Push = require('pushover-notifications');
const nodemailer = require('nodemailer');
var dateFormat = require('dateformat');
let productsNameMap = new Map();
let statusMap = new Map();

const apiUrl = 'https://api.ovh.com/1.0/dedicated/server/availabilities?country=ie';

let connection = mysql.createConnection({
    host: 'sqlhost',
    user: 'sqluser',
    password: 'sqlpass',
    database: 'sqldata'
});

let transporter = nodemailer.createTransport({
    host: 'mailhost',
    port: 587,
    secure: false,
    auth: {
        user: 'mailuser',
        pass: 'mailpass'
    },
    tls: {
        rejectUnauthorized: false
    }
});

connection.connect(function (err) {
    if (err) throw err;
    console.log("MySQL Connected!")
    connection.query("SELECT * FROM Products", function (err, results, fields) {
        if (err) throw err;
        results.forEach(function (row) {
            productsNameMap.set(row.product_name, row.human_name);
            statusMap.set(row.product_name, row.status);
        });
    });
});

console.log("Started.")

function startCheck() {
    fetch(apiUrl)
        .then(res => res.json())
        .then(json => initProducts(json));
}

startCheck();
setInterval(function () {
    startCheck();
}, 10000);


var products;

function initProducts(json) {
    products = json;
    for (let [key, value] of statusMap) {
        var pkey = getProduct(key);
        if (!(value === pkey)) {
            update(key, pkey);
            connection.query("UPDATE Products SET status='" + pkey + "' WHERE product_name='" + key + "'");
            console.log("Update " + pkey + " WHERE" + key);
        }
    }
}

function update(product, status) {
    statusMap.set(product, status);
    var humanStatus = (status === "false") ? "Out of stock" : "In stock";
    alert(product, productsNameMap.get(product), humanStatus);
}

function alert(productName, product, status) {
    var day = dateFormat(new Date(), "dd.mm.yyyy HH:MM:ss");
    connection.query("INSERT INTO Logs (product_name, new_status, date) VALUES ('" + product + "', '" + status + "', '" + day + "')");
    connection.query("SELECT * FROM Members WHERE product='" + product + "' OR product='*'", function (err, results, fields) {
        if (err) throw err;
        results.forEach(function (row) {
            console.log(product + " güncellendi! Yeni durum:" + status);
            if (row.discord_webhook) {
                discordAlert(productName, row.discord_webhook, product, status);
            }
            if (row.pushover) {
                pushoverAlert(productName, row.pushover, product, status);
            }
            if (row.email) {
                mailAlert(productName, row.email, row.name, product, status)
            }
        });
    });

}

function discordAlert(productName, webhook, product, status) {
    const hook = new Webhook(webhook);
    const embed = new MessageBuilder()
        .setTitle('soyoustart-notifier.com - Notifier Service')
        .setURL('https://soyoustart-notifier.com')
        .addField('Product', product, true)
        .addField('New Status', status, true)
        .addField('Product Link', "https://www.soyoustart.com/ie/offers/" + productName + ".xml ")
        .setColor(7785669)
        .setThumbnail('https://www.gigenet.com/wp-content/uploads/2020/02/Dedicated-Server-Hosting-Service.png')
        .setDescription('There is a change to a product you follow! ')
        .setFooter('soyoustart-notifier.com', 'https://soyoustart-notifier.com/assets/img/discord-logo.jpeg')
        .setTimestamp();
    hook.send(embed);
}

function pushoverAlert(productName, user, product, status) {
    var p = new Push({
        user: user,
        token: 'pushover token',
    });

    var msg = {
        message: 'There is a change to a product you follow! Product: ' + product + ", Status: " + status + ", URL: https://www.soyoustart.com/ie/offers/" + productName + ".xml",
        title: "soyoustart-notifier.com - Notifier Service",
        sound: 'siren',
        device: 'devicename',
        priority: 1
    }
    p.send(msg, (error, result) => {
        if (error) {
            console.error('[Pushover] An error occurred.');
            console.error(error);
            return;
        }
    });
}

function mailAlert(productName, email, name, product, status) {
    let infoMail = {
        from: 'SoYouStart Notifier <iletisim@ardagunsuren.com>',
        to: email,
        subject: 'soyoustart-notifier.com - Notifier Service',
        html: '<p>Hello ' + name + ',</p><p>There is a change to a product you follow! You can use the link below to quickly reach the product.</p><br><b>Product:</b> ' + product + '<br><b>Status:</b> ' + status + '<br><br><b>Product Link:</b> <a href="https://www.soyoustart.com/ie/offers/' + productName + '.xml">https://www.soyoustart.com/ie/offers/' + productName + '.xml</a><br><br><br><b>SoYouStart Notifier Service<b><br>Have a nice day!<br><a href="https://soyoustart-notifier.com">https://soyoustart-notifier.com</a><br><img src="https://soyoustart-notifier.com/assets/img/logo.png">'
    };
    transporter.sendMail(infoMail, function (error, info) {
        if (error) throw error;

    });
}

function getProduct(product) {
    var result = false;
    products.some(obj => {
        if (obj['hardware'] === product) {
            result = isAvailable(obj);
            if (result === "true") {
                return result;
            }
        }
    });
    return result;
}

function isAvailable(obj) {
    var bool = "false";
    obj['datacenters'].some(datacenter => {
        var availability = "" + datacenter['availability'] + "";
        if (!(availability === 'unavailable')) {
            bool = "true";
        }
    });
    return bool;
};
