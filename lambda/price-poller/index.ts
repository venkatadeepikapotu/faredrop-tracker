import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface Watch {
  watchId: string;
  userId: string;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  priceThreshold: number;
  currency: string;
  isActive: string;
  lastPrice?: number;
}

interface PriceResult {
  price: number;
  currency: string;
  airline?: string;
  flightNumber?: string;
  duration?: string;
  stops?: number;
}

let amadeusAccessToken: string | null = null;
let tokenExpiry: number = 0;

export const handler = async (event: EventBridgeEvent<string, any>) => {
  console.log('🚀 Price poller triggered at:', new Date().toISOString());
  
  try {
    const watches = await getActiveWatches();
    console.log(`📊 Found ${watches.length} active watches to poll`);

    if (watches.length === 0) {
      return { statusCode: 200, body: 'No active watches to poll' };
    }

    let successCount = 0;
    let errorCount = 0;

    for (const watch of watches) {
      try {
        await processWatch(watch);
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to process watch ${watch.watchId}:`, error);
        errorCount++;
      }
      
      // Small delay to respect rate limits
      await delay(500);
    }

    console.log(`✅ Polling complete: ${successCount} successful, ${errorCount} errors`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Price polling completed',
        watchesProcessed: watches.length,
        successful: successCount,
        errors: errorCount,
      }),
    };
  } catch (error) {
    console.error('💥 Fatal error in price poller:', error);
    throw error;
  }
};

async function getActiveWatches(): Promise<Watch[]> {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const result = await docClient.send(new ScanCommand({
      TableName: process.env.WATCHES_TABLE!,
      FilterExpression: 'isActive = :active AND departureDate >= :today',
      ExpressionAttributeValues: {
        ':active': 'true',
        ':today': today,
      },
    }));

    return (result.Items || []) as Watch[];
  } catch (error) {
    console.error('Error getting active watches:', error);
    return [];
  }
}

async function processWatch(watch: Watch): Promise<void> {
  console.log(`🔍 Processing: ${watch.origin} → ${watch.destination}`);

  try {
    const priceResult = await getFarePrice(watch);
    
    if (!priceResult) {
      console.log(`  ⚠️ No price found`);
      return;
    }

    console.log(`  💰 Price found: ${priceResult.currency} ${priceResult.price}`);

    await storePriceSnapshot(watch.watchId, priceResult);
    await updateWatchPrice(watch, priceResult.price);

    if (priceResult.price <= watch.priceThreshold) {
      console.log(`  🎉 ALERT: Price ${priceResult.price} <= threshold ${watch.priceThreshold}`);
      // Email alerts would go here (skipped for demo)
    } else {
      console.log(`  ℹ️ Price ${priceResult.price} > threshold ${watch.priceThreshold}`);
    }
  } catch (error) {
    console.error(`  ❌ Error processing watch:`, error);
    throw error;
  }
}

async function getFarePrice(watch: Watch): Promise<PriceResult | null> {
  try {
    await ensureAmadeusAuth();

    const url = new URL('https://test.api.amadeus.com/v2/shopping/flight-offers');
    url.searchParams.append('originLocationCode', watch.origin);
    url.searchParams.append('destinationLocationCode', watch.destination);
    url.searchParams.append('departureDate', watch.departureDate);
    if (watch.returnDate) {
      url.searchParams.append('returnDate', watch.returnDate);
    }
    url.searchParams.append('adults', '1');
    url.searchParams.append('currencyCode', watch.currency);
    url.searchParams.append('max', '1');

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${amadeusAccessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Amadeus API error: ${response.status}`, errorText);
      return null;
    }

    const data = await response.json() as any;

    if (!data.data || data.data.length === 0) {
      return null;
    }

    const offer = data.data[0];
    const firstItinerary = offer.itineraries[0];
    const firstSegment = firstItinerary.segments[0];

    return {
      price: parseFloat(offer.price.total),
      currency: offer.price.currency,
      airline: firstSegment.carrierCode,
      flightNumber: firstSegment.number,
      duration: firstItinerary.duration,
      stops: firstItinerary.segments.length - 1,
    };
  } catch (error) {
    console.error('Error fetching fare price:', error);
    return null;
  }
}

async function ensureAmadeusAuth(): Promise<void> {
  const now = Date.now();
  
  if (amadeusAccessToken && tokenExpiry > now + 300000) {
    return;
  }

  const clientId = process.env.AMADEUS_CLIENT_ID;
  const clientSecret = process.env.AMADEUS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Amadeus credentials not configured');
  }

  const tokenUrl = 'https://test.api.amadeus.com/v1/security/oauth2/token';
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get Amadeus token: ${response.status} ${errorText}`);
  }

  const data = await response.json() as any;
  amadeusAccessToken = data.access_token;
  tokenExpiry = now + (data.expires_in * 1000);
  
  console.log('✅ Authenticated with Amadeus API');
}

async function storePriceSnapshot(watchId: string, priceResult: PriceResult): Promise<void> {
  const now = new Date();
  const timestamp = now.toISOString();
  const ttl = Math.floor(now.getTime() / 1000) + (7 * 24 * 60 * 60); // 7 days

  await docClient.send(new PutCommand({
    TableName: process.env.PRICE_SNAPSHOTS_TABLE!,
    Item: {
      watchId,
      timestamp,
      price: priceResult.price,
      currency: priceResult.currency,
      source: 'amadeus',
      flightDetails: {
        airline: priceResult.airline,
        flightNumber: priceResult.flightNumber,
        duration: priceResult.duration,
        stops: priceResult.stops,
      },
      ttl,
    },
  }));
}

async function updateWatchPrice(watch: Watch, newPrice: number): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: process.env.WATCHES_TABLE!,
    Key: {
      userId: watch.userId,
      watchId: watch.watchId,
    },
    UpdateExpression: 'SET lastPrice = :price, lastCheckedAt = :checkedAt, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':price': newPrice,
      ':checkedAt': new Date().toISOString(),
      ':updatedAt': new Date().toISOString(),
    },
  }));
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}