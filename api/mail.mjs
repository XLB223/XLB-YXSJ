import net from "net";
import tls from "tls";

function encodeSubject(subject) {
  const bytes = Buffer.from(String(subject), "utf8");
  return `=?UTF-8?B?${bytes.toString("base64")}?=`;
}

function buildMessage({ from, to, subject, text }) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");
}

function createSmtpClient({ host, port, secure }) {
  const socket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });

  let buffer = "";

  const waitFor = (predicate) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("SMTP 连接超时")), 30000);

      function onData(chunk) {
        buffer += chunk;
        const lines = [];
        while (buffer.includes("\r\n")) {
          const idx = buffer.indexOf("\r\n");
          lines.push(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 2);
        }
        if (!lines.length) return;
        const last = lines[lines.length - 1];
        if (!/^\d{3} /.test(last) && !/^\d{3}-/.test(last)) return;
        if (!/^\d{3} /.test(last)) return;

        for (const line of lines) {
          const code = Number(line.slice(0, 3));
          if (code >= 400) {
            clearTimeout(timeout);
            socket.off("data", onData);
            reject(new Error(line));
          }
        }

        if (predicate(lines)) {
          clearTimeout(timeout);
          socket.off("data", onData);
          resolve(lines);
        }
      }

      socket.on("data", onData);
    });

  const send = (command) => {
    socket.write(`${command}\r\n`);
  };

  const ready = new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once(secure ? "secureConnect" : "connect", resolve);
  });

  return { socket, ready, waitFor, send };
}

async function sendSmtp({ host, port, secure, user, pass, from, to, message }) {
  const client = createSmtpClient({ host, port, secure });
  await client.ready;
  await client.waitFor((lines) => lines.some((line) => line.startsWith("220")));

  client.send("EHLO kjdsai.local");
  await client.waitFor((lines) => lines.some((line) => line.startsWith("250")));

  client.send("AUTH LOGIN");
  await client.waitFor((lines) => lines.some((line) => line.startsWith("334")));
  client.send(Buffer.from(user).toString("base64"));
  await client.waitFor((lines) => lines.some((line) => line.startsWith("334")));
  client.send(Buffer.from(pass).toString("base64"));
  await client.waitFor((lines) => lines.some((line) => line.startsWith("235")));

  client.send(`MAIL FROM:<${user}>`);
  await client.waitFor((lines) => lines.some((line) => line.startsWith("250")));
  client.send(`RCPT TO:<${to}>`);
  await client.waitFor((lines) => lines.some((line) => line.startsWith("250")));
  client.send("DATA");
  await client.waitFor((lines) => lines.some((line) => line.startsWith("354")));

  client.socket.write(`${message}\r\n.\r\n`);
  await client.waitFor((lines) => lines.some((line) => line.startsWith("250")));

  client.send("QUIT");
  client.socket.end();
}

export async function sendEmail({ to, subject, text }, env = process.env) {
  const host = env.SMTP_HOST;
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;
  const from = env.SMTP_FROM || user;
  const port = Number(env.SMTP_PORT || 465);
  const secure = String(env.SMTP_SECURE ?? "true").toLowerCase() !== "false";

  if (!host || !user || !pass || !from) {
    return {
      sent: false,
      error: "未配置 SMTP_HOST / SMTP_USER / SMTP_PASS / SMTP_FROM",
    };
  }

  try {
    await sendSmtp({
      host,
      port,
      secure,
      user,
      pass,
      from,
      to,
      message: buildMessage({ from, to, subject, text }),
    });
    return { sent: true };
  } catch (error) {
    return { sent: false, error: error.message || "邮件发送失败" };
  }
}

function adminNotifyEmail(env = process.env) {
  return (
    normalizeNotifyEmail(env.ADMIN_NOTIFY_EMAIL) ||
    normalizeNotifyEmail(env.CONTACT_EMAIL) ||
    normalizeNotifyEmail(env.SMTP_USER)
  );
}

function normalizeNotifyEmail(email) {
  const value = String(email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : "";
}

function shouldNotifyUser(env = process.env) {
  const raw = String(env.NOTIFY_USER_EMAIL ?? "false").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "on";
}

export async function sendWeChatNotify(title, content, env = process.env) {
  const pushplus = String(env.PUSHPLUS_TOKEN || "").trim();
  if (pushplus) {
    try {
      const res = await fetch("https://www.pushplus.plus/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pushplus, title, content, template: "txt" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.code === 200) return { sent: true, channel: "pushplus" };
      return { sent: false, error: data.msg || "PushPlus 发送失败" };
    } catch (error) {
      return { sent: false, error: error.message || "PushPlus 请求失败" };
    }
  }

  const sendkey = String(env.SERVERCHAN_SENDKEY || "").trim();
  if (sendkey) {
    try {
      const url = new URL(`https://sctapi.ftqq.com/${sendkey}.send`);
      url.searchParams.set("title", title);
      url.searchParams.set("desp", content);
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (data.code === 0 || data.data?.errno === 0) return { sent: true, channel: "serverchan" };
      return { sent: false, error: data.message || data.data?.errmsg || "Server酱 发送失败" };
    } catch (error) {
      return { sent: false, error: error.message || "Server酱 请求失败" };
    }
  }

  return { sent: false, error: "未配置 PUSHPLUS_TOKEN 或 SERVERCHAN_SENDKEY" };
}

export async function notifyAdminNewOrder(order, env = process.env, fulfillUrl = "") {
  const adminEmail = adminNotifyEmail(env);
  const planName = order.planName || order.planId;
  const typeLabel = order.type === "upgrade" ? "升级" : "开通";
  const title = `【新订单待确认】${order.orderId}`;
  const text = [
    "有新的付款订单待你核对：",
    "",
    `订单号：${order.orderId}`,
    `类型：${typeLabel}`,
    `套餐：${planName}`,
    `金额：${order.amountLabel}`,
    `下单时间：${order.createdAt}`,
    "",
    "请打开微信/支付宝收款记录，核对备注中的订单号与金额。",
    fulfillUrl
      ? "确认收款后，点击下面短时有效链接自动开通/升级（48 小时内有效）："
      : "确认收款后在服务器执行：",
    fulfillUrl || `node scripts/fulfill-order.mjs ${order.orderId}`,
    fulfillUrl ? fulfillUrl : "",
    "",
    "也可用命令行确认：node scripts/fulfill-order.mjs " + order.orderId,
  ]
    .filter(Boolean)
    .join("\n");

  const emailResult = adminEmail
    ? await sendEmail({ to: adminEmail, subject: title, text }, env)
    : { sent: false, error: "未配置 ADMIN_NOTIFY_EMAIL" };
  const wechatResult = await sendWeChatNotify(title, text.replace(/\n/g, "\n\n"), env);

  return { email: emailResult, wechat: wechatResult };
}

export async function notifyAdminFulfillCode(order, code, env = process.env) {
  const adminEmail = adminNotifyEmail(env);
  const planName = order.planName || order.planId;
  const typeLabel = order.type === "upgrade" ? "升级" : "开通";
  const title = `【已确认】${order.orderId}`;
  const text = [
    "订单已确认收款，会员已自动处理：",
    "",
    `订单号：${order.orderId}`,
    `套餐：${planName}（${order.amountLabel}）`,
    `类型：${typeLabel}`,
    code ? `关联码：${code}` : "",
    "",
    "用户页面会自动刷新显示会员状态。",
  ]
    .filter(Boolean)
    .join("\n");

  const emailResult = adminEmail
    ? await sendEmail({ to: adminEmail, subject: title, text }, env)
    : { sent: false, error: "未配置 ADMIN_NOTIFY_EMAIL" };
  const wechatResult = await sendWeChatNotify(
    title,
    `${typeLabel}完成\n套餐：${planName}\n订单：${order.orderId}`,
    env
  );

  return { email: emailResult, wechat: wechatResult };
}

export async function sendContactMessage({ message, contact, deviceId }, env = process.env) {
  const adminEmail = adminNotifyEmail(env);
  if (!adminEmail) {
    return { sent: false, error: "未配置 ADMIN_NOTIFY_EMAIL" };
  }
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) {
    return { sent: false, error: "留言内容不能为空" };
  }
  if (normalizedMessage.length > 2000) {
    return { sent: false, error: "留言内容过长（最多 2000 字）" };
  }
  const replyContact = String(contact || "").trim();
  const subject = "【客服留言】跨境AI Listing";
  const text = [
    "网站用户留言：",
    "",
    normalizedMessage,
    "",
    replyContact ? `用户联系方式：${replyContact}` : "用户未留联系方式",
    deviceId ? `设备ID：${deviceId}` : "",
    `时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
  ]
    .filter(Boolean)
    .join("\n");
  const result = await sendEmail({ to: adminEmail, subject, text }, env);
  if (result.sent) {
    return { sent: true, message: "留言已发送到客服邮箱" };
  }
  return result;
}

export async function sendOrderCodeEmail(
  { to, orderId, code, planName, amountLabel, type, siteUrl },
  env = process.env
) {
  const actionLabel = type === "upgrade" ? "升级邀请码" : "会员邀请码";
  const subject = `【跨境AI Listing】您的${actionLabel}（订单 ${orderId}）`;
  const text = [
    "您好，",
    "",
    `您的订单 ${orderId} 已确认收款（${planName}，${amountLabel}）。`,
    "",
    `${actionLabel}：${code}`,
    "",
    "使用步骤：",
    `1. 打开 https://${siteUrl.replace(/^https?:\/\//, "")}`,
    "2. 刷新页面或点击「查询订单」查看开通状态",
    "3. 管理员确认收款后一般会自动开通/升级，无需重复操作",
    "",
    "会员绑定当前电脑，换电脑请联系客服解绑。",
  ].join("\n");

  return sendEmail({ to, subject, text }, env);
}
