const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId, ObjectID } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);



const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello From RH Electronics!!')
})

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.1ch01.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' })
        }
        req.decoded = decoded;
        next();
    });
}

async function run(req, res, next) {

    try {
        await client.connect();
        const userCollection = client.db("rh_electronics").collection("users");
        const productCollection = client.db("rh_electronics").collection("products");
        const purchaseCollection = client.db('rh_electronics').collection("purchases");
        const paymentCollection = client.db("rh_electronics").collection("payments");
        const reviewCollection = client.db("rh_electronics").collection("reviews");

        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'Forbidden' });
            }
        }

        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const product = req.body;
            const price = product.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ['card']
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        //adding or updating user
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            var token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1d' });
            res.send({ result, token });
        })

        //getting info of all user
        app.get('/user', verifyJWT, async (req, res) => {
            const query = {};
            const cursor = userCollection.find(query);
            const users = await cursor.toArray();
            res.send(users);
        })

        //getting info of single user
        app.get('/user/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            res.send(user);
        })

        //getting admin users
        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin })
        })

        //giving user the role of admin
        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        })


        //Posting the products
        app.post('/product', verifyJWT, async (req, res) => {
            const product = req.body;
            const result = await productCollection.insertOne(product);
            res.send(result);
        })


        //getting the products 
        app.get('/product', async (req, res) => {
            const query = {};
            const cursor = productCollection.find(query);
            const products = await cursor.toArray();
            res.send(products);
        })

        //get single product
        app.get('/product/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const product = await productCollection.findOne(query);
            res.send(product);
        })

        //delete a product
        app.delete('/product/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await productCollection.deleteOne(query);
            res.send(result);
        })

        //total Products
        app.get('/productCount', async (req, res) => {
            const count = await productCollection.estimatedDocumentCount();
            res.send({ count });
        })

        //purchase post
        app.post('/purchase', verifyJWT, async (req, res) => {
            const purchase = req.body;
            const result = await purchaseCollection.insertOne(purchase);
            res.send(result);
        })


        //purchase details of a single user
        app.get('/purchase/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const cursor = purchaseCollection.find(query);
            const purchases = await cursor.toArray();
            res.send(purchases);
        })

        //purchase details of all users
        app.get('/purchase', verifyJWT, verifyAdmin, async (req, res) => {
            const query = {};
            const cursor = purchaseCollection.find(query);
            const purchases = await cursor.toArray();
            res.send(purchases);
        })

        //get information of a single purchased product
        app.get('/purchase/:email/:id', verifyJWT, async (req, res) => {
            const id = req.params;
            const email = req.params.email;
            const query = { _id: ObjectId(id), email: email };
            const purchase = await purchaseCollection.findOne(query);
            res.send(purchase);
        })

        //pay  product
        app.patch('/purchase/:email/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const email = req.params.email;
            const payment = req.body;
            const filter = { _id: ObjectId(id), email: email };
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId,
                }
            }
            const result = await paymentCollection.insertOne(payment);
            const updatePurchase = await purchaseCollection.updateOne(filter, updatedDoc);
            res.send(updatePurchase);
        })

        //ship  product
        app.patch('/purchase/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    shipped: true
                }
            }
            const updatePurchase = await purchaseCollection.updateOne(filter, updatedDoc);
            res.send(updatePurchase);
        })

        //add review
        app.post('/review', verifyJWT, async (req, res) => {
            const review = req.body;
            const result = await reviewCollection.insertOne(review);
            res.send(result);
        })



        //Cancel Order API
        app.delete('/purchase/:email', async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await purchaseCollection.deleteOne(filter);
            res.send(result);
        })



    }
    finally {

    }
}

run().catch(console.dir);

app.listen(port, () => {
    console.log(`RH Electronics app listening on port ${port}`)
})