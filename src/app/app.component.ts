import { Component, OnInit } from '@angular/core';
import { IdentityService } from './core/services/identity.service';
import { StorageService } from './core/services/storage.service';
import { CryptoService } from './core/services/crypto.service';

@Component({
  selector: 'app-root',
  template: `
    <h1>Secure Messenger Core v1.1</h1>
    <p>Open Console (F12) to see the security test with E2EE.</p>
  `,
})
export class AppComponent implements OnInit {
  constructor(
    private identity: IdentityService,
    private storage: StorageService,
    private crypto: CryptoService,
  ) {}

  async ngOnInit() {
    try {
      console.log('--- PHASE 1 FULL SECURITY TEST (with E2EE) ---');

      const mnemonicAlice = await this.identity.createNewAccount('Alice');
      const alice = this.identity.getUser()!;
      console.log('1. Alice created. Ed25519 Public Key:', alice.id);
      console.log('   Mnemonic:', mnemonicAlice);

      const bobMnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'; // тестовая мнемоника
      const seedBob = await import('bip39').then((bip39) => bip39.mnemonicToSeed(bobMnemonic));
      const seedBob32 = new Uint8Array(seedBob.slice(0, 32));
      const bobKeyPairEd = this.crypto.generateKeyPairFromSeed(seedBob32);
      const bobPublicEdHex = this.crypto.toHex(bobKeyPairEd.publicKey);
      console.log('2. Bob created (simulated). Ed25519 Public Key:', bobPublicEdHex);

      const dbKeyAlice = this.crypto.hash(this.crypto.toHex(alice.keyPair.privateKey));
      await this.storage.initDB(alice.id, dbKeyAlice);
      console.log('3. DB initialized for Alice');

      await this.storage.addUser({
        id: bobPublicEdHex,
        username: 'Bob',
      });
      console.log("4. Bob saved in Alice's DB (encrypted)");

      const aliceEncryptPublic = this.crypto.convertEd25519PublicKeyToX25519(
        alice.keyPair.publicKey,
      );
      const aliceEncryptPrivate = this.crypto.convertEd25519PrivateKeyToX25519(
        alice.keyPair.privateKey,
      );
      const bobEncryptPublic = this.crypto.convertEd25519PublicKeyToX25519(bobKeyPairEd.publicKey);
      const bobEncryptPrivate = this.crypto.convertEd25519PrivateKeyToX25519(
        bobKeyPairEd.privateKey,
      );

      const secretMessage = 'Привет, Боб! Это сообщение зашифровано для тебя.';
      const encrypted = this.crypto.encryptMessage(
        secretMessage,
        bobEncryptPublic,
        aliceEncryptPrivate,
      );
      console.log(
        '5. Alice encrypted message. Ciphertext:',
        encrypted.ciphertext.substring(0, 60) + '...',
      );

      const decrypted = this.crypto.decryptMessage(
        encrypted.ciphertext,
        encrypted.nonce,
        aliceEncryptPublic,
        bobEncryptPrivate,
      );
      console.log('6. Bob decrypted message:', decrypted);

      if (decrypted === secretMessage) {
        console.log(
          '%c SUCCESS: End-to-End Encryption with converted keys works!',
          'color: green; font-size: 14px',
        );
      } else {
        console.error('E2EE failed');
      }

      await this.storage.addMessage({
        id: 'msg_' + Date.now(),
        senderId: alice.id,
        receiverId: bobPublicEdHex,
        text: secretMessage,
        timestamp: Date.now(),
        status: 'sent',
      });
      console.log('7. Message saved in DB (encrypted)');

      this.storage.getMessages(bobPublicEdHex)?.subscribe((rawMsgs) => {
        const decryptedMsgs = this.storage.decryptMessages(rawMsgs);
        const lastMsg = decryptedMsgs[decryptedMsgs.length - 1];
        console.log('8. Decrypted message from DB:', lastMsg.text);
        if (lastMsg.text === secretMessage) {
          console.log(
            '%c SUCCESS: DB encryption works alongside E2EE!',
            'color: green; font-size: 14px',
          );
        }
      });
    } catch (err) {
      console.error('Test Failed:', err);
    }
  }
}
