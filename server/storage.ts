import { getFirestore, USERS_COLLECTION, TRADES_COLLECTION, COLLECTIONS_COLLECTION, convertFirestoreData, convertFirestoreCollection } from "./firebase";
import * as admin from 'firebase-admin';

export class FirebaseStorage {
  private db: admin.firestore.Firestore;
  private counterRef: admin.firestore.DocumentReference;

  constructor() {
    this.db = getFirestore();
    this.counterRef = this.db.collection('system').doc('counters');
    this.initializeCounters();
  }

  private async initializeCounters() {
    const countersDoc = await this.counterRef.get();
    if (!countersDoc.exists) {
      await this.counterRef.set({
        userId: 1,
        tradeId: 1,
        collectionId: 1
      });
    }
  }

  private async getNextId(counterName: string): Promise<number> {
    const result = await this.db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(this.counterRef);
      const currentValue = counterDoc.data()?.[counterName] || 1;
      transaction.update(this.counterRef, { [counterName]: currentValue + 1 });
      return currentValue;
    });
    return result;
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const query = await this.db.collection(USERS_COLLECTION).where('id', '==', id).limit(1).get();
    if (query.empty) return undefined;
    const userData = convertFirestoreData<User>(query.docs[0]);
    return userData || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const query = await this.db.collection(USERS_COLLECTION).where('username', '==', username).limit(1).get();
    if (query.empty) return undefined;
    const userData = convertFirestoreData<User>(query.docs[0]);
    return userData || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const query = await this.db.collection(USERS_COLLECTION).where('email', '==', email).limit(1).get();
    if (query.empty) return undefined;
    const userData = convertFirestoreData<User>(query.docs[0]);
    return userData || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = await this.getNextId('userId');
    const createdAt = new Date();
    
    const user: User = {
      ...insertUser,
      id,
      createdAt,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      planType: "free",
      avatar: insertUser.avatar || null
    };
    
    await this.db.collection(USERS_COLLECTION).doc(id.toString()).set(user);
    return user;
  }

  async updateUserStripeInfo(userId: number, stripeInfo: { customerId: string, subscriptionId: string }): Promise<User> {
    const userRef = this.db.collection(USERS_COLLECTION).doc(userId.toString());
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      throw new Error("User not found");
    }
    
    const updatedData = {
      stripeCustomerId: stripeInfo.customerId,
      stripeSubscriptionId: stripeInfo.subscriptionId
    };
    
    await userRef.update(updatedData);
    
    const updatedUserDoc = await userRef.get();
    const updatedUser = convertFirestoreData<User>(updatedUserDoc);
    
    if (!updatedUser) {
      throw new Error("Failed to update user");
    }
    
    return updatedUser;
  }

  async updateUserPlan(userId: number, planType: string): Promise<User> {
    const userRef = this.db.collection(USERS_COLLECTION).doc(userId.toString());
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      throw new Error("User not found");
    }
    
    await userRef.update({ planType });
    
    const updatedUserDoc = await userRef.get();
    const updatedUser = convertFirestoreData<User>(updatedUserDoc);
    
    if (!updatedUser) {
      throw new Error("Failed to update user");
    }
    
    return updatedUser;
  }

  // Trade operations
  async createTrade(insertTrade: InsertTrade): Promise<Trade> {
    const id = await this.getNextId('tradeId');
    const createdAt = new Date();
    
    const trade: Trade = {
      ...insertTrade,
      id,
      createdAt,
      notes: insertTrade.notes || null,
      collectionId: insertTrade.collectionId || null
    };
    
    await this.db.collection(TRADES_COLLECTION).doc(id.toString()).set(trade);
    return trade;
  }

  async getTrade(id: number): Promise<Trade | undefined> {
    const tradeDoc = await this.db.collection(TRADES_COLLECTION).doc(id.toString()).get();
    const tradeData = convertFirestoreData<Trade>(tradeDoc);
    return tradeData || undefined;
  }

  async getUserTrades(userId: number): Promise<Trade[]> {
    const query = await this.db.collection(TRADES_COLLECTION).where('userId', '==', userId).get();
    return convertFirestoreCollection<Trade>(query);
  }

  async getCollectionTrades(collectionId: number): Promise<Trade[]> {
    const query = await this.db.collection(TRADES_COLLECTION).where('collectionId', '==', collectionId).get();
    return convertFirestoreCollection<Trade>(query);
  }

  async updateTrade(id: number, tradeUpdate: Partial<InsertTrade>): Promise<Trade> {
    const tradeRef = this.db.collection(TRADES_COLLECTION).doc(id.toString());
    const tradeDoc = await tradeRef.get();
    
    if (!tradeDoc.exists) {
      throw new Error("Trade not found");
    }
    
    await tradeRef.update(tradeUpdate);
    
    const updatedTradeDoc = await tradeRef.get();
    const updatedTrade = convertFirestoreData<Trade>(updatedTradeDoc);
    
    if (!updatedTrade) {
      throw new Error("Failed to update trade");
    }
    
    return updatedTrade;
  }

  async deleteTrade(id: number): Promise<boolean> {
    const tradeRef = this.db.collection(TRADES_COLLECTION).doc(id.toString());
    const tradeDoc = await tradeRef.get();
    
    if (!tradeDoc.exists) {
      return false;
    }
    
    await tradeRef.delete();
    return true;
  }

  // Collection operations
  async createCollection(insertCollection: InsertCollection): Promise<Collection> {
    const id = await this.getNextId('collectionId');
    const createdAt = new Date();
    
    const collection: Collection = {
      ...insertCollection,
      id,
      createdAt,
      description: insertCollection.description || null
    };
    
    await this.db.collection(COLLECTIONS_COLLECTION).doc(id.toString()).set(collection);
    return collection;
  }

  async getCollection(id: number): Promise<Collection | undefined> {
    const collectionDoc = await this.db.collection(COLLECTIONS_COLLECTION).doc(id.toString()).get();
    const collectionData = convertFirestoreData<Collection>(collectionDoc);
    return collectionData || undefined;
  }

  async getUserCollections(userId: number): Promise<Collection[]> {
    const query = await this.db.collection(COLLECTIONS_COLLECTION).where('userId', '==', userId).get();
    return convertFirestoreCollection<Collection>(query);
  }

  async updateCollection(id: number, collectionUpdate: Partial<InsertCollection>): Promise<Collection> {
    const collectionRef = this.db.collection(COLLECTIONS_COLLECTION).doc(id.toString());
    const collectionDoc = await collectionRef.get();
    
    if (!collectionDoc.exists) {
      throw new Error("Collection not found");
    }
    
    await collectionRef.update(collectionUpdate);
    
    const updatedCollectionDoc = await collectionRef.get();
    const updatedCollection = convertFirestoreData<Collection>(updatedCollectionDoc);
    
    if (!updatedCollection) {
      throw new Error("Failed to update collection");
    }
    
    return updatedCollection;
  }

  async deleteCollection(id: number): Promise<boolean> {
    const collectionRef = this.db.collection(COLLECTIONS_COLLECTION).doc(id.toString());
    const collectionDoc = await collectionRef.get();
    
    if (!collectionDoc.exists) {
      return false;
    }
    
    await collectionRef.delete();
    return true;
  }
}

export const storage = new FirebaseStorage();
