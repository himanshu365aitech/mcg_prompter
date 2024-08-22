const express = require('express');
const AWS = require('aws-sdk');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAICacheManager, GoogleAIFileManager } = require('@google/generative-ai/server');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

app.use(express.json());

// Configure AWS S3
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
});

let contextCacheName = null || "cachedContents/vb4vngzcsnwa";

// API to load and cache context mapping
app.post('/load-context', async (req, res) => {
    try {

        // Step 1: Retrieve the file from S3
        const params = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: process.env.S3_KEY_NAME,
        };

        const s3Data = await s3.getObject(params).promise();
        const fileContent = s3Data.Body.toString('utf-8');

        // Step 2: Save the content to a temporary file
        const tempFilePath = path.join(__dirname, 'temp-file.txt');
        fs.writeFileSync(tempFilePath, fileContent);

        // Step 3: Upload the file using the file path
        const fileManager = new GoogleAIFileManager(process.env.API_KEY);
        const uploadResult = await fileManager.uploadFile(tempFilePath, {
            mimeType: 'text/plain',
            displayName: 'Large Context File',
        });

        // Step 4: Cache the uploaded file content with a TTL
        const cacheManager = new GoogleAICacheManager(process.env.API_KEY);
        const cacheResult = await cacheManager.create({
            model: 'models/gemini-1.5-flash-001',
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            fileData: {
                                mimeType: uploadResult.file.mimeType,
                                fileUri: uploadResult.file.uri,
                            },
                        },
                    ],
                },
            ],
            ttlSeconds: 3600, // Cache for 1 hour
        });

        contextCacheName = cacheResult.name; // Save the cache name for later use
        console.log('Context mapping cached successfully:', contextCacheName);

        // Clean up the temporary file
        fs.unlinkSync(tempFilePath);

        res.status(200).send({ message: 'Context loaded and cached successfully', contextCacheName });
    } catch (error) {
        res.status(500).send('Error loading and caching context mapping');
    }
});

// API to delete the cached context
app.delete('/delete-context', async (req, res) => {
    if (!contextCacheName) {
        return res.status(400).send('No cached context to delete.');
    }

    try {
        const cacheManager = new GoogleAICacheManager(process.env.API_KEY);
        await cacheManager.delete(contextCacheName);

        contextCacheName = null;
        res.status(200).send({ message: 'Context cache deleted successfully' });
    } catch (error) {
        res.status(500).send('Error deleting context cache');
    }
});

// Function to find the closest match in context mapping using Gemini
async function findClosestMatch(inputData, prompt) {
    try {
        if (!contextCacheName) {
            throw new Error('Context cache is not loaded yet. Please load the context first.');
        }


        const genAI = new GoogleGenerativeAI(process.env.API_KEY);

        const model = genAI.getGenerativeModelFromCachedContent({
            name: contextCacheName,
            model: 'models/gemini-1.5-flash-001' // The model used during caching
        });

        // Adjusting the structure to correctly pass the prompt
        const geminiResult = await model.generateContent({
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: prompt }, // The prompt should be here
                        { text: `Given the input data, find the closest match: ${inputData}` }
                    ],
                },
            ],
        });

        return geminiResult.response.text();
    } catch (error) {
        await deleteContextCache();
        throw error;
    }
}



// Function to delete the context cache
async function deleteContextCache() {
    if (!contextCacheName) {
        return;
    }

    try {
        const cacheManager = new GoogleAICacheManager(process.env.API_KEY);
        await cacheManager.delete(contextCacheName);
        contextCacheName = null;
    } catch (error) {
    }
}

// Server endpoint for processing user request
app.post('/find-match', async (req, res) => {

    try {
        if (!contextCacheName) {
            return res.status(503).send('Service Unavailable: Context cache is not ready yet.');
        }


        const { data: inputData, prompt } = req.body;

        if (!inputData || !prompt) {
            return res.status(400).send('Missing data or prompt.');
        }


        const closestMatch = await findClosestMatch(inputData, prompt);

        res.send({ closestMatch });
    } catch (error) {
        await deleteContextCache(); // Ensure context cache is deleted if an error occurs
        res.status(500).send('Error finding match');
    } finally {
    }
});

app.listen(port, () => console.log(`Server listening on port ${port}`));
