import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { z } from "zod";
import { storage } from "./storage";
import { insertUserSchema, insertTradeSchema, insertCollectionSchema } from "@shared/schema";
import Stripe from "stripe";
import { compare, hash } from "bcryptjs";

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('Missing STRIPE_SECRET_KEY. Stripe payment processing will be disabled.');
}

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-03-31.basil",
    })
  : null;

// Helper to verify user is authenticated
const ensureAuthenticated = (req: Request, res: Response, next: Function) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Configure session
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "trade-journal-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: process.env.NODE_ENV === "production" }
    })
  );

  // Initialize passport
  app.use(passport.initialize());
  app.use(passport.session());

  // Configure passport
  passport.use(
    new LocalStrategy(
      {
        usernameField: "email",
        passwordField: "password",
      },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email);
          if (!user) {
            return done(null, false, { message: "Invalid email or password" });
          }

          const isPasswordValid = await compare(password, user.password);
          if (!isPasswordValid) {
            return done(null, false, { message: "Invalid email or password" });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  // Test route to create a test user (development only)
  app.get("/api/create-test-user", async (req, res) => {
    try {
      // Check if test user already exists
      const existingUser = await storage.getUserByEmail("test@example.com");
      if (existingUser) {
        return res.json({
          message: "Test user already exists",
          email: "test@example.com",
          password: "test123"
        });
      }
      
      // Create test user
      const hashedPassword = await hash("test123", 10);
      
      const user = await storage.createUser({
        username: "testuser",
        email: "test@example.com",
        password: hashedPassword,
        avatar: null
      });
      
      // Remove password from response
      const { password: _, ...safeUser } = user;
      
      return res.status(201).json({
        message: "Test user created successfully",
        user: safeUser,
        credentials: {
          email: "test@example.com",
          password: "test123"
        }
      });
    } catch (error: any) {
      console.error("Error creating test user:", error);
      return res.status(500).json({ message: error.message || "Internal server error" });
    }
  });

  // Auth routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const validateResult = insertUserSchema.safeParse(req.body);
      
      if (!validateResult.success) {
        return res.status(400).json({ message: "Invalid user data", errors: validateResult.error.errors });
      }
      
      const { email, username, password } = validateResult.data;
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }
      
      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername) {
        return res.status(400).json({ message: "Username already taken" });
      }
      
      // Hash password
      const hashedPassword = await hash(password, 10);
      
      // Create user
      const user = await storage.createUser({
        ...validateResult.data,
        password: hashedPassword,
      });
      
      // Remove password from response
      const { password: _, ...safeUser } = user;
      
      return res.status(201).json(safeUser);
    } catch (error: any) {
      console.error("Register error:", error);
      return res.status(500).json({ message: error.message || "Internal server error" });
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: Error, user: any, info: any) => {
      if (err) {
        return next(err);
      }
      if (!user) {
        return res.status(401).json({ message: info.message });
      }
      req.logIn(user, (err) => {
        if (err) {
          return next(err);
        }
        
        // Remove password from response
        const { password, ...safeUser } = user;
        return res.json(safeUser);
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: "Error logging out" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/current-user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    const { password, ...safeUser } = req.user as any;
    res.json(safeUser);
  });

  // Trade routes
  app.get("/api/trades", ensureAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const trades = await storage.getUserTrades(userId);
      res.json(trades);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/trades", ensureAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const validateResult = insertTradeSchema.safeParse({
        ...req.body,
        userId
      });
      
      if (!validateResult.success) {
        return res.status(400).json({ message: "Invalid trade data", errors: validateResult.error.errors });
      }
      
      const trade = await storage.createTrade(validateResult.data);
      res.status(201).json(trade);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/trades/:id", ensureAuthenticated, async (req, res) => {
    try {
      const trade = await storage.getTrade(parseInt(req.params.id));
      
      if (!trade) {
        return res.status(404).json({ message: "Trade not found" });
      }
      
      const userId = (req.user as any).id;
      if (trade.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      res.json(trade);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/trades/:id", ensureAuthenticated, async (req, res) => {
    try {
      const tradeId = parseInt(req.params.id);
      const trade = await storage.getTrade(tradeId);
      
      if (!trade) {
        return res.status(404).json({ message: "Trade not found" });
      }
      
      const userId = (req.user as any).id;
      if (trade.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const updatedTrade = await storage.updateTrade(tradeId, req.body);
      res.json(updatedTrade);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/trades/:id", ensureAuthenticated, async (req, res) => {
    try {
      const tradeId = parseInt(req.params.id);
      const trade = await storage.getTrade(tradeId);
      
      if (!trade) {
        return res.status(404).json({ message: "Trade not found" });
      }
      
      const userId = (req.user as any).id;
      if (trade.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      await storage.deleteTrade(tradeId);
      res.json({ message: "Trade deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Collection routes
  app.get("/api/collections", ensureAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const collections = await storage.getUserCollections(userId);
      res.json(collections);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/collections", ensureAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const validateResult = insertCollectionSchema.safeParse({
        ...req.body,
        userId
      });
      
      if (!validateResult.success) {
        return res.status(400).json({ message: "Invalid collection data", errors: validateResult.error.errors });
      }
      
      const collection = await storage.createCollection(validateResult.data);
      res.status(201).json(collection);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/collections/:id", ensureAuthenticated, async (req, res) => {
    try {
      const collection = await storage.getCollection(parseInt(req.params.id));
      
      if (!collection) {
        return res.status(404).json({ message: "Collection not found" });
      }
      
      const userId = (req.user as any).id;
      if (collection.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      res.json(collection);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/collections/:id/trades", ensureAuthenticated, async (req, res) => {
    try {
      const collectionId = parseInt(req.params.id);
      const collection = await storage.getCollection(collectionId);
      
      if (!collection) {
        return res.status(404).json({ message: "Collection not found" });
      }
      
      const userId = (req.user as any).id;
      if (collection.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const trades = await storage.getCollectionTrades(collectionId);
      res.json(trades);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/collections/:id", ensureAuthenticated, async (req, res) => {
    try {
      const collectionId = parseInt(req.params.id);
      const collection = await storage.getCollection(collectionId);
      
      if (!collection) {
        return res.status(404).json({ message: "Collection not found" });
      }
      
      const userId = (req.user as any).id;
      if (collection.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const updatedCollection = await storage.updateCollection(collectionId, req.body);
      res.json(updatedCollection);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/collections/:id", ensureAuthenticated, async (req, res) => {
    try {
      const collectionId = parseInt(req.params.id);
      const collection = await storage.getCollection(collectionId);
      
      if (!collection) {
        return res.status(404).json({ message: "Collection not found" });
      }
      
      const userId = (req.user as any).id;
      if (collection.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      await storage.deleteCollection(collectionId);
      res.json({ message: "Collection deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stripe payment routes
  if (stripe) {
    app.post("/api/create-payment-intent", ensureAuthenticated, async (req, res) => {
      try {
        const { amount } = req.body;
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100), // Convert to cents
          currency: "usd",
        });
        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: "Error creating payment intent: " + error.message });
      }
    });

    app.post('/api/create-subscription', ensureAuthenticated, async (req, res) => {
      try {
        const user = req.user as any;
        const { planId } = req.body;
        
        if (!planId) {
          return res.status(400).json({ message: "Plan ID is required" });
        }

        let customerId = user.stripeCustomerId;
        
        // Create or use existing customer
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: user.email,
            name: user.username,
          });
          
          customerId = customer.id;
          await storage.updateUserStripeInfo(user.id, { 
            customerId: customer.id, 
            subscriptionId: user.stripeSubscriptionId || "" 
          });
        }
        
        // Create subscription
        const subscription = await stripe.subscriptions.create({
          customer: customerId,
          items: [{
            price: planId,
          }],
          payment_behavior: 'default_incomplete',
          expand: ['latest_invoice.payment_intent'],
        });
        
        // Update user with subscription ID
        await storage.updateUserStripeInfo(user.id, {
          customerId,
          subscriptionId: subscription.id
        });
        
        // Update user plan type
        const planType = planId.includes('pro') ? 'pro' : 'basic';
        await storage.updateUserPlan(user.id, planType);
        
        // Return client secret for payment confirmation
        const latestInvoice = subscription.latest_invoice as any;
        const clientSecret = latestInvoice?.payment_intent?.client_secret;
        
        res.json({
          subscriptionId: subscription.id,
          clientSecret
        });
      } catch (error: any) {
        console.error("Subscription error:", error);
        res.status(500).json({ message: "Error creating subscription: " + error.message });
      }
    });
  }

  const httpServer = createServer(app);
  return httpServer;
}
