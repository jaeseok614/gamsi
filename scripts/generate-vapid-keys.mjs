import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log('WEB_PUSH_SUBJECT="mailto:admin@example.com"');
console.log(`WEB_PUSH_VAPID_PUBLIC_KEY="${keys.publicKey}"`);
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY="${keys.privateKey}"`);
