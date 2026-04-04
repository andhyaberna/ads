/**
 * Users.gs - User Management Module
 * Admin CRUD operations for user management
 */

// ─────────────────────────────────────────────────────────────────────────────
// LIST USERS (with search/filter/pagination)
// ─────────────────────────────────────────────────────────────────────────────

function apiListUsers_(payload, adminUser) {
  var options = {
    search: payload.search || '',
    role: payload.role || '',
    payment_status: payload.payment_status || ''
  };
  
  var users = listUsers_(options);
  
  // Pagination
  var page = Math.max(1, Number(payload.page) || 1);
  var pageSize = Math.min(100, Math.max(10, Number(payload.page_size) || 20));
  var total = users.length;
  var totalPages = Math.ceil(total / pageSize);
  var start = (page - 1) * pageSize;
  var end = start + pageSize;
  
  var paginated = users.slice(start, end);
  
  return {
    ok: true,
    users: paginated,
    pagination: {
      page: page,
      page_size: pageSize,
      total: total,
      total_pages: totalPages
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET USER DETAIL
// ─────────────────────────────────────────────────────────────────────────────

function apiGetUser_(payload, adminUser) {
  var userId = payload.user_id;
  if (!userId) {
    return { ok: false, error: 'user_id wajib diisi' };
  }
  
  var user = getUserById_(userId);
  if (!user) {
    return { ok: false, error: 'User tidak ditemukan' };
  }
  
  // Return without sensitive data
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      payment_status: user.payment_status,
      created_at: user.created_at,
      updated_at: user.updated_at,
      last_login: user.last_login,
      is_active: user.is_active
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE USER
// ─────────────────────────────────────────────────────────────────────────────

function apiUpdateUser_(payload, adminUser) {
  var userId = payload.user_id;
  if (!userId) {
    return { ok: false, error: 'user_id wajib diisi' };
  }
  
  var user = getUserById_(userId);
  if (!user) {
    return { ok: false, error: 'User tidak ditemukan' };
  }
  
  // Prevent admin from demoting themselves if they're the last admin
  if (userId === adminUser.id && payload.role === 'user') {
    var allUsers = getSheetRows_('users');
    var adminCount = allUsers.filter(function (u) {
      return u.role === 'admin' && u.is_active === 'true';
    }).length;
    
    if (adminCount <= 1) {
      return { ok: false, error: 'Tidak dapat mengubah role. Minimal harus ada 1 admin aktif.' };
    }
  }
  
  var updates = {};
  
  // Name
  if (payload.name !== undefined) {
    var nameVal = validateName_(payload.name);
    if (!nameVal.valid) return { ok: false, error: nameVal.error };
    updates.name = String(payload.name).trim();
  }
  
  // Role
  if (payload.role !== undefined) {
    if (['admin', 'user'].indexOf(payload.role) < 0) {
      return { ok: false, error: 'Role harus admin atau user' };
    }
    updates.role = payload.role;
  }
  
  // Payment status
  if (payload.payment_status !== undefined) {
    if (['LUNAS', 'PENDING', 'NONE'].indexOf(payload.payment_status) < 0) {
      return { ok: false, error: 'Status pembayaran tidak valid' };
    }
    updates.payment_status = payload.payment_status;
  }
  
  // Active status
  if (payload.is_active !== undefined) {
    // Prevent deactivating self
    if (userId === adminUser.id && payload.is_active === 'false') {
      return { ok: false, error: 'Tidak dapat menonaktifkan akun sendiri' };
    }
    updates.is_active = payload.is_active === true || payload.is_active === 'true' ? 'true' : 'false';
  }
  
  // Email (with validation)
  if (payload.email !== undefined && payload.email !== user.email) {
    var emailVal = validateEmail_(payload.email);
    if (!emailVal.valid) return { ok: false, error: emailVal.error };
    
    // Check if new email already exists
    var existing = getUserByEmail_(payload.email);
    if (existing) {
      return { ok: false, error: 'Email sudah digunakan user lain' };
    }
    updates.email = String(payload.email).toLowerCase().trim();
  }
  
  if (Object.keys(updates).length === 0) {
    return { ok: false, error: 'Tidak ada data yang diupdate' };
  }
  
  var updatedUser = updateUser_(userId, updates);
  
  // If role or status changed, revoke all sessions for this user
  if (updates.role !== undefined || updates.payment_status !== undefined || updates.is_active === 'false') {
    revokeAllUserSessions_(userId);
  }
  
  return {
    ok: true,
    message: 'User berhasil diupdate',
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
      payment_status: updatedUser.payment_status,
      is_active: updatedUser.is_active
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE USER
// ─────────────────────────────────────────────────────────────────────────────

function apiDeleteUser_(payload, adminUser) {
  var userId = payload.user_id;
  if (!userId) {
    return { ok: false, error: 'user_id wajib diisi' };
  }
  
  // Prevent self-deletion
  if (userId === adminUser.id) {
    return { ok: false, error: 'Tidak dapat menghapus akun sendiri' };
  }
  
  var user = getUserById_(userId);
  if (!user) {
    return { ok: false, error: 'User tidak ditemukan' };
  }
  
  // Check if this is the last admin
  if (user.role === 'admin') {
    var allUsers = getSheetRows_('users');
    var adminCount = allUsers.filter(function (u) {
      return u.role === 'admin';
    }).length;
    
    if (adminCount <= 1) {
      return { ok: false, error: 'Tidak dapat menghapus admin terakhir' };
    }
  }
  
  // Revoke all sessions first
  revokeAllUserSessions_(userId);
  
  // Delete user
  deleteUser_(userId);
  
  return {
    ok: true,
    message: 'User berhasil dihapus'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE USER (by admin)
// ─────────────────────────────────────────────────────────────────────────────

function apiCreateUser_(payload, adminUser) {
  var email = String(payload.email || '').toLowerCase().trim();
  var password = payload.password || '';
  var name = String(payload.name || '').trim();
  var role = payload.role || 'user';
  var paymentStatus = payload.payment_status || 'NONE';
  
  // Validate inputs
  var emailVal = validateEmail_(email);
  if (!emailVal.valid) return { ok: false, error: emailVal.error };
  
  var passVal = validatePassword_(password);
  if (!passVal.valid) return { ok: false, error: passVal.error };
  
  var nameVal = validateName_(name);
  if (!nameVal.valid) return { ok: false, error: nameVal.error };
  
  // Validate role
  if (['admin', 'user'].indexOf(role) < 0) {
    return { ok: false, error: 'Role harus admin atau user' };
  }
  
  // Validate payment status
  if (['LUNAS', 'PENDING', 'NONE'].indexOf(paymentStatus) < 0) {
    return { ok: false, error: 'Status pembayaran tidak valid' };
  }
  
  // Check if email already exists
  var existingUser = getUserByEmail_(email);
  if (existingUser) {
    return { ok: false, error: 'Email sudah terdaftar' };
  }
  
  // Create user
  var salt = generateSalt_();
  var passwordHash = hashPassword_(password, salt);
  
  var user = createUser_({
    email: email,
    password_hash: passwordHash,
    salt: salt,
    name: name,
    role: role,
    payment_status: paymentStatus,
    is_active: 'true'
  });
  
  return {
    ok: true,
    message: 'User berhasil dibuat',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      payment_status: user.payment_status
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESET USER PASSWORD (by admin)
// ─────────────────────────────────────────────────────────────────────────────

function apiResetUserPassword_(payload, adminUser) {
  var userId = payload.user_id;
  var newPassword = payload.new_password;
  
  if (!userId) {
    return { ok: false, error: 'user_id wajib diisi' };
  }
  if (!newPassword) {
    return { ok: false, error: 'new_password wajib diisi' };
  }
  
  var user = getUserById_(userId);
  if (!user) {
    return { ok: false, error: 'User tidak ditemukan' };
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
  
  // Revoke all sessions
  revokeAllUserSessions_(userId);
  
  return {
    ok: true,
    message: 'Password berhasil direset. User harus login kembali.'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK UPDATE STATUS (for admin convenience)
// ─────────────────────────────────────────────────────────────────────────────

function apiBulkUpdateStatus_(payload, adminUser) {
  var userIds = payload.user_ids || [];
  var paymentStatus = payload.payment_status;
  
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { ok: false, error: 'user_ids harus berupa array dan tidak boleh kosong' };
  }
  
  if (['LUNAS', 'PENDING', 'NONE'].indexOf(paymentStatus) < 0) {
    return { ok: false, error: 'Status pembayaran tidak valid' };
  }
  
  var updated = 0;
  var errors = [];
  
  userIds.forEach(function (userId) {
    var user = getUserById_(userId);
    if (!user) {
      errors.push('User ' + userId + ' tidak ditemukan');
      return;
    }
    
    updateUser_(userId, { payment_status: paymentStatus });
    revokeAllUserSessions_(userId);
    updated++;
  });
  
  return {
    ok: true,
    message: updated + ' user berhasil diupdate',
    updated_count: updated,
    errors: errors
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET USER STATS (for admin dashboard)
// ─────────────────────────────────────────────────────────────────────────────

function apiGetUserStats_() {
  var users = getSheetRows_('users');
  
  var stats = {
    total: users.length,
    active: 0,
    inactive: 0,
    admins: 0,
    regular_users: 0,
    lunas: 0,
    pending: 0,
    none: 0
  };
  
  users.forEach(function (u) {
    if (u.is_active === 'true') stats.active++;
    else stats.inactive++;
    
    if (u.role === 'admin') stats.admins++;
    else stats.regular_users++;
    
    if (u.payment_status === 'LUNAS') stats.lunas++;
    else if (u.payment_status === 'PENDING') stats.pending++;
    else stats.none++;
  });
  
  return { ok: true, stats: stats };
}
