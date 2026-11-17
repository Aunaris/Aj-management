'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'classroom-test-'));
process.env.STORAGE_DIR = path.join(tmp, 'storage');
process.env.DB_FILE = path.join(tmp, 'test.db');

const db = require('../src/db');
db.open(process.env.DB_FILE);
const seed = require('../src/seed');
seed.seedBase({ forceChange: false });
seed.seedDemo();
const { createApp } = require('../src/app');

const app = createApp();

async function login(username, password = username, { deviceId } = {}) {
  const agent = request.agent(app);
  if (deviceId) agent.jar.setCookie(`did=${deviceId}; Path=/`, '127.0.0.1');
  const res = await agent.post('/login').type('form').send({ login: username, password, next: '/' });
  if (res.status !== 302) throw new Error(`login failed for ${username}: ${res.status}`);
  const page = await agent.get('/notifications');
  const m = /name="csrf-token" content="([^"]+)"/.exec(page.text);
  agent.csrf = m ? m[1] : '';
  return agent;
}

function q(sql, ...args) {
  return db.get().prepare(sql).all(...args);
}
function one(sql, ...args) {
  return db.get().prepare(sql).get(...args);
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5e7f3a40000000049454e44ae426082', 'hex');

module.exports = { app, login, db, q, one, PNG, request, tmp };
