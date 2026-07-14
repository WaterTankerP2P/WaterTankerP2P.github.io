/*
 * email-config.js — EmailJS keys for sending the 6-digit verification code.
 * The public key is designed to be exposed in client code. To prevent abuse,
 * restrict this key to your domain in the EmailJS dashboard:
 *   Account → Security → "Allowed origins" → add https://watertankerp2p.github.io
 *
 * The email template (template_590ue2o) should reference the code as {{otp_code}}
 * (aliases {{passcode}}/{{code}} also sent) and the recipient as {{to_email}}.
 */
window.AQUA_EMAILJS = {
  publicKey: "O6Y_LzOcJI0c5zcyU",
  serviceId: "service_62nbuxm",
  templateId: "template_590ue2o"
};
