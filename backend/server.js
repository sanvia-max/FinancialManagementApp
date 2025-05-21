const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { check, validationResult } = require('express-validator');
const db = require('./db');
require('dotenv').config();

// Initialize express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// ==================== MIDDLEWARE ====================

/**
 * Authentication middleware
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ message: 'Access denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid token' });
  }
};

/**
 * Admin middleware
 */
const isAdmin = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    return next();
  }
  return res.status(403).json({ message: 'Admin access required' });
};

// ==================== USER CONTROLLERS ====================

/**
 * Register a new user
 */
const registerUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { firstName, lastName, email, password } = req.body;

  try {
    // Check if user exists
    const userCheck = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const result = await db.query(
      'INSERT INTO users (first_name, last_name, email, password) VALUES ($1, $2, $3, $4) RETURNING id, email, is_admin',
      [firstName, lastName, email, hashedPassword]
    );

    // Generate token
    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, isAdmin: user.is_admin },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Login user
 */
const loginUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    // Find user
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];
    
    // Check if account is active
    if (!user.is_active) {
      return res.status(401).json({ message: 'Account is inactive' });
    }

    // Validate password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Generate token
    const token = jwt.sign(
      { id: user.id, email: user.email, isAdmin: user.is_admin },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      message: 'Login successful',
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Get user profile
 */
const getUserProfile = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, first_name, last_name, email, is_admin, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==================== FINANCE CONTROLLERS ====================

/**
 * Create a transaction (expense or income)
 */
const createTransaction = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { 
    categoryId, 
    amount, 
    description, 
    date, 
    type,
    isRecurring, 
    recurringInterval, 
    isTaxRelated 
  } = req.body;
  
  const userId = req.user.id;

  try {
    const result = await db.query(
      `INSERT INTO transactions 
       (user_id, category_id, amount, description, date, type, is_recurring, recurring_interval, is_tax_related) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`,
      [userId, categoryId, amount, description, date, type, isRecurring, recurringInterval, isTaxRelated]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Get user transactions
 */
const getTransactions = async (req, res) => {
  const userId = req.user.id;
  const { startDate, endDate, categoryId, type } = req.query;
  
  try {
    let query = `
      SELECT t.*, c.name as category_name 
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE t.user_id = $1
    `;
    
    const queryParams = [userId];
    let paramCount = 2;
    
    if (startDate) {
      query += ` AND t.date >= $${paramCount}`;
      queryParams.push(startDate);
      paramCount++;
    }
    
    if (endDate) {
      query += ` AND t.date <= $${paramCount}`;
      queryParams.push(endDate);
      paramCount++;
    }
    
    if (categoryId) {
      query += ` AND t.category_id = $${paramCount}`;
      queryParams.push(categoryId);
      paramCount++;
    }
    
    if (type) {
      query += ` AND t.type = $${paramCount}`;
      queryParams.push(type);
    }
    
    query += ' ORDER BY t.date DESC';
    
    const result = await db.query(query, queryParams);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Create a budget
 */
const createBudget = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { categoryId, amount, startDate, endDate } = req.body;
  const userId = req.user.id;

  try {
    const result = await db.query(
      `INSERT INTO budgets (user_id, category_id, amount, start_date, end_date) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [userId, categoryId, amount, startDate, endDate]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating budget:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Create a debt
 */
const createDebt = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, initialAmount, currentBalance, interestRate, minimumPayment, dueDate } = req.body;
  const userId = req.user.id;

  try {
    const result = await db.query(
      `INSERT INTO debts 
       (user_id, name, initial_amount, current_balance, interest_rate, minimum_payment, due_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING *`,
      [userId, name, initialAmount, currentBalance, interestRate, minimumPayment, dueDate]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating debt:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Get financial summary
 */
const getFinancialSummary = async (req, res) => {
  const userId = req.user.id;
  const { month, year } = req.query;
  
  try {
    // Define date range
    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];
    
    // Get income
    const incomeResult = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total_income
       FROM transactions
       WHERE user_id = $1 AND type = 'income'
       AND date BETWEEN $2 AND $3`,
      [userId, startDate, endDate]
    );
    
    // Get expenses
    const expensesResult = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total_expenses
       FROM transactions
       WHERE user_id = $1 AND type = 'expense'
       AND date BETWEEN $2 AND $3`,
      [userId, startDate, endDate]
    );
    
    // Get expenses by category
    const expensesByCategory = await db.query(
      `SELECT c.name, COALESCE(SUM(t.amount), 0) as amount
       FROM transactions t
       JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = $1 AND t.type = 'expense'
       AND t.date BETWEEN $2 AND $3
       GROUP BY c.name
       ORDER BY amount DESC`,
      [userId, startDate, endDate]
    );
    
    const totalIncome = parseFloat(incomeResult.rows[0].total_income);
    const totalExpenses = parseFloat(expensesResult.rows[0].total_expenses);
    
    res.json({
      period: `${month}/${year}`,
      totalIncome,
      totalExpenses,
      netSavings: totalIncome - totalExpenses,
      savingsRate: totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome * 100).toFixed(2) : 0,
      expensesByCategory: expensesByCategory.rows
    });
  } catch (error) {
    console.error('Error generating financial summary:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ==================== ROUTES ====================

// User routes
app.post(
  '/api/users/register',
  [
    check('firstName', 'First name is required').not().isEmpty(),
    check('lastName', 'Last name is required').not().isEmpty(),
    check('email', 'Please include a valid email').isEmail(),
    check('password', 'Password must be 6+ characters').isLength({ min: 6 })
  ],
  registerUser
);

app.post(
  '/api/users/login',
  [
    check('email', 'Please include a valid email').isEmail(),
    check('password', 'Password is required').exists()
  ],
  loginUser
);

app.get('/api/users/profile', authenticateToken, getUserProfile);

// Transaction routes
app.post(
  '/api/finance/transactions',
  authenticateToken,
  [
    check('categoryId', 'Category ID is required').isInt(),
    check('amount', 'Amount must be a positive number').isFloat({ gt: 0 }),
    check('date', 'Date is required').isISO8601(),
    check('type', 'Type must be expense or income').isIn(['expense', 'income'])
  ],
  createTransaction
);

app.get('/api/finance/transactions', authenticateToken, getTransactions);

// Budget routes
app.post(
  '/api/finance/budgets',
  authenticateToken,
  [
    check('categoryId', 'Category ID is required').isInt(),
    check('amount', 'Amount must be a positive number').isFloat({ gt: 0 }),
    check('startDate', 'Start date is required').isISO8601(),
    check('endDate', 'End date is required').isISO8601()
  ],
  createBudget
);

// Debt routes
app.post(
  '/api/finance/debts',
  authenticateToken,
  [
    check('name', 'Name is required').not().isEmpty(),
    check('initialAmount', 'Initial amount must be a positive number').isFloat({ gt: 0 }),
    check('currentBalance', 'Current balance must be a positive number').isFloat({ gt: 0 }),
    check('interestRate', 'Interest rate must be a number').isFloat({ min: 0 })
  ],
  createDebt
);

// Financial summary
app.get(
  '/api/finance/summary',
  authenticateToken,
  [
    check('month', 'Month must be a number between 1 and 12').isInt({ min: 1, max: 12 }),
    check('year', 'Year must be a number').isInt()
  ],
  getFinancialSummary
);

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'Financial Management API' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});