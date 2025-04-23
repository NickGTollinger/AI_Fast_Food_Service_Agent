// routes/authRoutes.js
console.log("authRoutes.js loaded and mounted");

const express = require('express');
const { getUserCollection } = require('../db');
const { v4: uuidv4 } = require('uuid'); // Needed to generate customerId
const router = express.Router();

// Signup endpoint (storing credentials in plain text for demo purposes)
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  // Check that email and password are provided
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  // Validate password: at least 8 characters, at least one special character and one number
  const passwordRegex = /^(?=.*[!@#$%^&*])(?=.*\d)(?=.{8,})/;
  if (!passwordRegex.test(password)) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 8 characters long and include at least one special character and one number.'
    });
  }

  try {
    const userCollection = await getUserCollection();

    // Check if user already exists
    const existingUser = await userCollection.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists.' });
    }

    // Generate customerId
    const customerId = `cus_${uuidv4().split('-')[0]}`;

    // Add it to the stored object
    const newUser = { email, password, customerId };
    console.log("Attempting to insert user:", newUser); // <-- ADD THIS
    await userCollection.insertOne(newUser);
    console.log("Inserted user into MongoDB"); // <-- ADD THIS

    return res.status(201).json({
      success: true,
      message: 'User created successfully.',
      customerId
    });
  } catch (err) {
    console.error('Signup error: ', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Login endpoint (plain text verification)
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  try {
    const userCollection = await getUserCollection();
    const user = await userCollection.findOne({ email });

    if (!user || user.password !== password) {
      return res.status(400).json({ success: false, message: 'Invalid credentials.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      customerId: user.customerId
    });
  } catch (err) {
    console.error('Login error: ', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
