/**
 * Auth.gs - Authentication Module
 * Handles user registration, login, password hashing, and token management
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

var AUTH_TOKEN_TTL_HOURS = 24;
var AUTH_SALT_LENGTH = 32;
var AUTH_MIN_PASSWORD_LENGTH = 8;
var AUTH_PLAINTEXT_SALT_MARKER = 'PLAINTEXT';

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD HASHING (SHA-256 + Salt)
// ─────────────────────────────────────────────────────────────────────────────

function generateSalt_() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var salt = '';
  for (var i = 0; i < AUTH_SALT_LENGTH; i++) {
    salt += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return salt;
}

function hashPassword_(password, salt) {
  var combined = salt + password + salt;
  var signature = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, combined);
  return signature.map(function (b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

function verifyPassword_(password, hash, salt) {
  if (isPlaintextPasswordRecord_(hash, salt)) {
    return String(password || '') === String(hash || '');
  }
  var computed = hashPassword_(password, String(salt || ''));
  return computed === String(hash || '');
}

function getAuthPasswordMode_() {
  var mode = String(getScriptConfig_('AUTH_PASSWORD_MODE', '') || '').trim();
  if (!mode) {
    try {
      var settings = getSheetRows_('settings');
      for (var i = 0; i < settings.length; i++) {
        if (String(settings[i].key_name || '').toUpperCase() === 'AUTH_PASSWORD_MODE') {
          mode = String(settings[i].key_value || '').trim();
          break;
        }
      }
    } catch (err) {
      mode = '';
    }
  }
  mode = String(mode || 'HASHED').toUpperCase();
  return mode === 'PLAINTEXT' ? 'PLAINTEXT' : 'HASHED';
}

function shouldStorePlaintextPasswords_() {
  return getAuthPasswordMode_() === 'PLAINTEXT';
}

function isPlaintextPasswordRecord_(hash, salt) {
  var hashText = String(hash || '');
  if (!hashText) return false;
  var saltText = String(salt || '').toUpperCase();
  if (saltText === AUTH_PLAINTEXT_SALT_MARKER) return true;
  return saltText === '';
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

function validateEmail_(email) {
  if (!email) return { valid: false, error: 'Email wajib diisi' };
  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Format email tidak valid' };
  }
  return { valid: true };
}

function validatePassword_(password) {
  if (!password) return { valid: false, error: 'Password wajib diisi' };
  if (password.length < AUTH_MIN_PASSWORD_LENGTH) {
    return { valid: false, error: 'Password minimal ' + AUTH_MIN_PASSWORD_LENGTH + ' karakter' };
  }
  // Check for at least one number and one letter
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password harus mengandung minimal 1 angka' };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, error: 'Password harus mengandung minimal 1 huruf' };
  }
  return { valid: true };
}

function validateName_(name) {
  if (!name || !String(name).trim()) {
    return { valid: false, error: 'Nama wajib diisi' };
  }
  if (String(name).trim().length < 2) {
    return { valid: false, error: 'Nama minimal 2 karakter' };
  }
  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN GENERATION & VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

function generateAuthToken_(userId, email, role, paymentStatus) {
  var tokenId = 'tok_' + Utilities.getUuid();
  var now = new Date();
  var expiresAt = new Date(now.getTime() + (AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000));
  
  var session = {
    token_id: tokenId,
    user_id: userId,
    email: email,
    role: role,
    payment_status: paymentStatus,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    is_revoked: 'false'
  };
  
  createSession_(session);
  
  // Create signed token payload
  var payload = {
    tid: tokenId,
    uid: userId,
    email: email,
    role: role,
    status: paymentStatus,
    exp: expiresAt.getTime()
  };
  
  var payloadStr = JSON.stringify(payload);
  var payloadB64 = Utilities.base64EncodeWebSafe(payloadStr);
  
  // Sign the payload
  var secret = getScriptConfig_('INTERNAL_API_TOKEN', 'default-secret');
  var signature = Utilities.computeHmacSha256Signature(payloadB64, secret);
  var signatureB64 = Utilities.base64EncodeWebSafe(signature);
  
  return payloadB64 + '.' + signatureB64;
}

function validateAuthToken_(token) {
  if (!token) {
    return { valid: false, error: 'Token tidak ditemukan' };
  }
  
  var parts = String(token).split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Format token tidak valid' };
  }
  
  var payloadB64 = parts[0];
  var signatureB64 = parts[1];
  
  // Verify signature
  var secret = getScriptConfig_('INTERNAL_API_TOKEN', 'default-secret');
  var expectedSig = Utilities.computeHmacSha256Signature(payloadB64, secret);
  var expectedSigB64 = Utilities.base64EncodeWebSafe(expectedSig);
  
  if (signatureB64 !== expectedSigB64) {
    return { valid: false, error: 'Token signature tidak valid' };
  }
  
  // Decode payload
  var payloadStr;
  try {
    payloadStr = Utilities.newBlob(Utilities.base64DecodeWebSafe(payloadB64)).getDataAsString();
  } catch (e) {
    return { valid: false, error: 'Token payload tidak valid' };
  }
  
  var payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch (e) {
    return { valid: false, error: 'Token payload bukan JSON valid' };
  }
  
  // Check expiration
  if (!payload.exp || payload.exp < Date.now()) {
    return { valid: false, error: 'Token sudah expired' };
  }
  
  // Check session in database
  var session = getSessionByToken_(payload.tid);
  if (!session) {
    return { valid: false, error: 'Session tidak ditemukan' };
  }
  
  if (session.is_revoked === 'true') {
    return { valid: false, error: 'Session telah di-revoke' };
  }
  
  // Get fresh user data
  var user = getUserById_(payload.uid);
  if (!user) {
    return { valid: false, error: 'User tidak ditemukan' };
  }
  
  if (user.is_active !== 'true') {
    return { valid: false, error: 'Akun tidak aktif' };
  }
  
  return {
    valid: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      payment_status: user.payment_status
    },
    token_id: payload.tid
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

function registerUser_(payload) {
  ensureDbReady();
  
  var email = String(payload.email || '').toLowerCase().trim();
  var password = payload.password || '';
  var name = String(payload.name || '').trim();
  
  // Validate inputs
  var emailVal = validateEmail_(email);
  if (!emailVal.valid) return { ok: false, error: emailVal.error };
  
  var passVal = validatePassword_(password);
  if (!passVal.valid) return { ok: false, error: passVal.error };
  
  var nameVal = validateName_(name);
  if (!nameVal.valid) return { ok: false, error: nameVal.error };
  
  // Check if email already exists
  var existingUser = getUserByEmail_(email);
  if (existingUser) {
    return { ok: false, error: 'Email sudah terdaftar' };
  }
  
  // Create user
  var salt = shouldStorePlaintextPasswords_() ? AUTH_PLAINTEXT_SALT_MARKER : generateSalt_();
  var passwordHash = shouldStorePlaintextPasswords_() ? String(password) : hashPassword_(password, salt);
  
  var user = createUser_({
    email: email,
    password_hash: passwordHash,
    salt: salt,
    name: name,
    role: 'user',
    payment_status: 'NONE',
    is_active: 'true'
  });
  
  // Generate token
  var token = generateAuthToken_(user.id, user.email, user.role, user.payment_status);
  
  return {
    ok: true,
    message: 'Registrasi berhasil',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      payment_status: user.payment_status
    },
    token: token
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────────────────────

function loginUser_(payload) {
  ensureDbReady();
  
  var email = String(payload.email || '').toLowerCase().trim();
  var password = payload.password || '';
  
  // Validate inputs
  if (!email) return { ok: false, error: 'Email wajib diisi' };
  if (!password) return { ok: false, error: 'Password wajib diisi' };
  
  // Find user
  var user = getUserByEmail_(email);
  if (!user) {
    return { ok: false, error: 'Email atau password salah' };
  }
  
  // Check if active
  if (user.is_active !== 'true') {
    return { ok: false, error: 'Akun tidak aktif. Hubungi admin.' };
  }
  
  // Verify password
  if (!verifyPassword_(password, user.password_hash, user.salt)) {
    return { ok: false, error: 'Email atau password salah' };
  }
  
  // Update last login
  updateUser_(user.id, { last_login: new Date().toISOString() });
  
  // Generate token
  var token = generateAuthToken_(user.id, user.email, user.role, user.payment_status);
  
  return {
    ok: true,
    message: 'Login berhasil',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      payment_status: user.payment_status
    },
    token: token
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────────────────────────────────────

function logoutUser_(tokenId) {
  if (tokenId) {
    revokeSession_(tokenId);
  }
  return { ok: true, message: 'Logout berhasil' };
}

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD CHANGE
// ─────────────────────────────────────────────────────────────────────────────

function changePassword_(userId, oldPassword, newPassword) {
  var user = getUserById_(userId);
  if (!user) {
    return { ok: false, error: 'User tidak ditemukan' };
  }
  
  // Verify old password
  if (!verifyPassword_(oldPassword, user.password_hash, user.salt)) {
    return { ok: false, error: 'Password lama salah' };
  }
  
  // Validate new password
  var passVal = validatePassword_(newPassword);
  if (!passVal.valid) return { ok: false, error: passVal.error };
  
  // Generate new salt and hash
  var newSalt = generateSalt_();
  var newHash = hashPassword_(newPassword, newSalt);
  
  // Update user
  updateUser_(userId, {
    password_hash: newHash,
    salt: newSalt
  });
  
  // Revoke all sessions for security
  revokeAllUserSessions_(userId);
  
  return { ok: true, message: 'Password berhasil diubah. Silakan login kembali.' };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: CREATE FIRST ADMIN
// ─────────────────────────────────────────────────────────────────────────────

function createFirstAdmin_(email, password, name) {
  ensureDbReady();
  
  // Check if any admin exists
  var users = getSheetRows_('users');
  var hasAdmin = users.some(function (u) { return u.role === 'admin'; });
  
  if (hasAdmin) {
    return { ok: false, error: 'Admin sudah ada. Gunakan admin panel untuk menambah admin.' };
  }
  
  // Validate inputs
  var emailVal = validateEmail_(email);
  if (!emailVal.valid) return { ok: false, error: emailVal.error };
  
  var passVal = validatePassword_(password);
  if (!passVal.valid) return { ok: false, error: passVal.error };
  
  var nameVal = validateName_(name);
  if (!nameVal.valid) return { ok: false, error: nameVal.error };
  
  // Check if email already exists
  var existingUser = getUserByEmail_(email);
  if (existingUser) {
    return { ok: false, error: 'Email sudah terdaftar' };
  }
  
  // Create admin user
  var salt = shouldStorePlaintextPasswords_() ? AUTH_PLAINTEXT_SALT_MARKER : generateSalt_();
  var passwordHash = shouldStorePlaintextPasswords_() ? String(password) : hashPassword_(password, salt);
  
  var user = createUser_({
    email: String(email).toLowerCase().trim(),
    password_hash: passwordHash,
    salt: salt,
    name: String(name).trim(),
    role: 'admin',
    payment_status: 'LUNAS',
    is_active: 'true'
  });
  
  return {
    ok: true,
    message: 'Admin pertama berhasil dibuat',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN VERIFICATION (for protected routes)
// ─────────────────────────────────────────────────────────────────────────────

function verifyToken_(token) {
  var result = validateAuthToken_(token);
  if (!result.valid) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    user: result.user
  };
}
