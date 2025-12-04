import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';  // ✅ ADDED

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sesClient = new SESClient({ region: process.env.SES_REGION || 'us-east-1' });  // ✅ ADDED

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
  lastAlertSent?: string;  // ✅ ADDED
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

// ✅ ADDED - Email sending function
async function sendPriceDropEmail(watch: Watch, currentPrice: number): Promise<boolean> {
  const savings = watch.priceThreshold - currentPrice;
  
  console.log(`📧 Sending email alert for watch ${watch.watchId}`);
  
  try {
    await sesClient.send(new SendEmailCommand({
      Source: process.env.VERIFIED_EMAIL!,
      Destination: { 
        ToAddresses: [process.env.VERIFIED_EMAIL!] 
      },
      Message: {
        Subject: { 
          Data: `✈️ Price Drop Alert: ${watch.origin} → ${watch.destination}` 
        },
        Body: {
          Html: {
            Data: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
                <div style="background-color: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <h1 style="color: #2563eb; margin-bottom: 20px; font-size: 24px;">
                    ✈️ Great News! Flight Price Dropped!
                  </h1>
                  
                  <div style="background-color: #eff6ff; padding: 20px; border-radius: 6px; margin: 20px 0;">
                    <table style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="padding: 8px 0; color: #6b7280; font-weight: 600;">Route:</td>
                        <td style="padding: 8px 0; text-align: right; font-weight: 700; font-size: 18px;">
                          ${watch.origin} → ${watch.destination}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #6b7280; font-weight: 600;">Departure Date:</td>
                        <td style="padding: 8px 0; text-align: right; font-weight: 600;">
                          ${watch.departureDate}
                        </td>
                      </tr>
                      <tr style="border-top: 2px solid #dbeafe;">
                        <td style="padding: 12px 0; color: #6b7280; font-weight: 600;">Current Price:</td>
                        <td style="padding: 12px 0; text-align: right;">
                          <span style="color: #16a34a; font-size: 32px; font-weight: 700;">$${currentPrice}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #6b7280; font-weight: 600;">Your Threshold:</td>
                        <td style="padding: 8px 0; text-align: right; text-decoration: line-through; color: #9ca3af;">
                          $${watch.priceThreshold}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #6b7280; font-weight: 600;">You Save:</td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #16a34a; font-size: 20px; font-weight: 700;">$${savings}</span>
                        </td>
                      </tr>
                    </table>
                  </div>
                  
                  <div style="text-align: center; margin: 30px 0;">
                    <a href="https://www.google.com/flights?q=${watch.origin}%20to%20${watch.destination}" 
                       style="display: inline-block; background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
                      🔍 Book This Flight Now
                    </a>
                  </div>
                  
                  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                    <p style="color: #6b7280; font-size: 12px; margin: 5px 0;">
                      💡 Tip: Prices can change quickly! Book soon to secure this deal.
                    </p>
                    <p style="color: #9ca3af; font-size: 11px; margin-top: 15px;">
                      You're receiving this alert from FareDrop Tracker.<br/>
                      Watch ID: ${watch.watchId}
                    </p>
                  </div>
                </div>
              </div>
            `
          },
          Text: {
            Data: `
✈️ FareDrop Tracker - Price Drop Alert!

Route: ${watch.origin} → ${watch.destination}
Departure Date: ${watch.departureDate}

CURRENT PRICE: $${currentPrice}
Your Threshold: $${watch.priceThreshold}
YOU SAVE: $${savings}

Book now at: https://www.google.com/flights?q=${watch.origin}+to+${watch.destination}

---
FareDrop Tracker Alert System
Watch ID: ${watch.watchId}
            `
          }
        }
      }
    }));
    
    console.log('✅ Email sent successfully!');
    return true;
  } catch (error) {
    console.error('❌ Failed to send email:', error);
    return false;
  }
}

export const handler = async (event: EventBridgeEvent<string, any>) => {
  console.log('🚀 Price poller triggered at:', new Date().toISOString());
  console.log('📧 Email configured for:', process.env.VERIFIED_EMAIL);  // ✅ ADDED
  
  try {
    const watches = await getActiveWatches();
    console.log(`📊 Found ${watches.length} active watches to poll`);

    if (watches.length === 0) {
      return { statusCode: 200, body: 'No active watches to poll' };
    }

    let successCount = 0;
    let errorCount = 0;
    let alertsSent = 0;  // ✅ ADDED

    for (const watch of watches) {
      try {
        const alertSent = await processWatch(watch);  // ✅ MODIFIED
        if (alertSent) alertsSent++;  // ✅ ADDED
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to process watch ${watch.watchId}:`, error);
        errorCount++;
      }
      
      // Small delay to respect rate limits
      await delay(500);
    }

    console.log(`✅ Polling complete: ${successCount} successful, ${errorCount} errors, ${alertsSent} alerts sent`);  // ✅ MODIFIED

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Price polling completed',
        watchesProcessed: watches.length,
        successful: successCount,
        errors: errorCount,
        alertsSent,  // ✅ ADDED
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

// ✅ MODIFIED - Now returns boolean indicating if alert was sent
async function processWatch(watch: Watch): Promise<boolean> {
  console.log(`🔍 Processing: ${watch.origin} → ${watch.destination}`);

  try {
    const priceResult = await getFarePrice(watch);
    
    if (!priceResult) {
      console.log(`  ⚠️ No price found`);
      return false;
    }

    console.log(`  💰 Price found: ${priceResult.currency} ${priceResult.price}`);

    await storePriceSnapshot(watch.watchId, priceResult);
    await updateWatchPrice(watch, priceResult.price);

    // ✅ MODIFIED - Check threshold and send email
    if (priceResult.price <= watch.priceThreshold) {
      console.log(`  🔔 PRICE DROP! ${priceResult.price} <= threshold ${watch.priceThreshold}`);
      
      // Check if we sent an alert recently (last 24 hours)
      const lastAlert = watch.lastAlertSent ? new Date(watch.lastAlertSent) : null;
      const hoursSince = lastAlert 
        ? (Date.now() - lastAlert.getTime()) / (1000 * 60 * 60)
        : 999;

      if (hoursSince > 24) {
        console.log(`  📧 Last alert was ${hoursSince.toFixed(1)}h ago - sending new alert`);
        
        const emailSent = await sendPriceDropEmail(watch, priceResult.price);
        
        if (emailSent) {
          // Update lastAlertSent timestamp
          await docClient.send(new UpdateCommand({
            TableName: process.env.WATCHES_TABLE!,
            Key: { userId: watch.userId, watchId: watch.watchId },
            UpdateExpression: 'SET lastAlertSent = :now',
            ExpressionAttributeValues: { ':now': new Date().toISOString() }
          }));
          
          console.log('  ✅ Alert sent and timestamp updated');
          return true;
        }
      } else {
        console.log(`  ⏭️ Alert already sent ${hoursSince.toFixed(1)}h ago - skipping`);
      }
    } else {
      console.log(`  ℹ️ Price ${priceResult.price} > threshold ${watch.priceThreshold}`);
    }
    
    return false;
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