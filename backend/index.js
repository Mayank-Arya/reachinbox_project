const express = require("express");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require("express-session");
const path = require("path");
const cors = require("cors");
const { google } = require("googleapis");
const axios = require("axios");
const base64url = require("base64url"); 
require('dotenv').config()

const app = express();
const OPENAI_API_KEY = process.env.OPENAI_KEY;


app.use(cors());
app.use(express.json()); 
app.use(session({ secret: "secret", resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());


passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    (accessToken, refreshToken, profile, done) => {
      console.log("Access Token:", accessToken);
      app.locals.user = { profile, accessToken };
      return done(null, profile);
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});


const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL
);


app.use(express.static(path.join(__dirname, "public")));

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: [
      "profile",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ],
  })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    res.redirect("/profile");
  }
);

app.get("/profile", async (req, res) => {
  if (!app.locals.user) {
    res.redirect("/");
    return;
  }

  oauth2Client.setCredentials({
    access_token: app.locals.user.accessToken,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    const response = await gmail.users.messages.list({
      userId: "me",
      maxResults: 10,
    });

    const messages = response.data.messages || [];
    const emailPromises = messages.map(async (message) => {
      const email = await gmail.users.messages.get({
        userId: "me",
        id: message.id,
        format: "full",
      });

      const headers = email.data.payload.headers;
      const subject =
        headers.find((header) => header.name === "Subject")?.value ||
        "No Subject";
      const from =
        headers.find((header) => header.name === "From")?.value ||
        "Unknown Sender";

      let body = "";
      if (email.data.payload.parts) {
        body = email.data.payload.parts[0].body.data;
      } else if (email.data.payload.body) {
        body = email.data.payload.body.data;
      }

      const decodedBody = body
        ? Buffer.from(body, "base64").toString("utf-8")
        : "No content";

      return { id: message.id, subject, from, content: decodedBody };
    });

    const emails = await Promise.all(emailPromises);

    res.sendFile(path.join(__dirname, "public", "index.html"));
  } catch (error) {
    console.error("Error fetching emails:", error);
    res.status(500).send("Error fetching emails");
  }
});

app.get("/email/:id", async (req, res) => {
  if (!app.locals.user) {
    res.redirect("/");
    return;
  }

  const { id } = req.params;

  oauth2Client.setCredentials({
    access_token: app.locals.user.accessToken,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    const email = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });

    const headers = email.data.payload.headers;
    const subject =
      headers.find((header) => header.name === "Subject")?.value ||
      "No Subject";
    const from =
      headers.find((header) => header.name === "From")?.value ||
      "Unknown Sender";
    const body = email.data.payload.parts
      ? email.data.payload.parts[0].body.data
      : email.data.payload.body.data;

    const decodedBody = Buffer.from(body, "base64").toString("utf-8");

    res.send({ subject, from, body: decodedBody });
  } catch (error) {
    console.error("Error fetching email details:", error);
    res.status(500).send("Error fetching email details");
  }
});

app.post("/suggest-response", async (req, res) => {
  if (!app.locals.user) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  const { content } = req.body;

  if (!content) {
    return res.status(400).json({ error: "Content is required" });
  }
  
  const prompt = `Suggest a response for the following email content: ${content}`;
  try {
    const response = await axios.post(
      process.env.OPENAI_completion,
      {
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1150,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    const suggestion = response.data.choices[0].message.content;

    if (!suggestion) {
      return res.status(500).json({ error: "No suggestion generated" });
    }

    res.json({ suggestion });
  } catch (error) {
    console.error("Failed to suggest response:", error);
    res.status(500).json({ error: "Failed to suggest response" });
  }
});

async function categorizeEmailContent(content) {
  const prompt = `Categorize the following email content into one of the categories: Interested, Not Interested, More Information. Content: ${content}`;

  try {
    const response = await axios.post(
      process.env.OPENAI_completion,
      {
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 50,
        temperature: 0.5,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const category = response.data.choices[0].message.content.trim();
    return category;
  } catch (error) {
    console.error("Error categorizing email:", error);
    return "More Information";
  }
}

app.get("/api/emails", async (req, res) => {
  if (!app.locals.user) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  oauth2Client.setCredentials({
    access_token: app.locals.user.accessToken,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    const response = await gmail.users.messages.list({
      userId: "me",
      maxResults: 10,
    });

    const messages = response.data.messages || [];
    const emailPromises = messages.map(async (message) => {
      const email = await gmail.users.messages.get({
        userId: "me",
        id: message.id,
        format: "full",
      });

      const headers = email.data.payload.headers;
      const subject =
        headers.find((header) => header.name === "Subject")?.value ||
        "No Subject";
      const from =
        headers.find((header) => header.name === "From")?.value ||
        "Unknown Sender";

      let body = "";
      if (email.data.payload.parts) {
        body = email.data.payload.parts[0].body.data;
      } else if (email.data.payload.body) {
        body = email.data.payload.body.data;
      }

      const decodedBody = body
        ? Buffer.from(body, "base64").toString("utf-8")
        : "No content";

      const category = await categorizeEmailContent(decodedBody);

      return { id: message.id, subject, from, category };
    });

    const emails = await Promise.all(emailPromises);

    res.json(emails);
  } catch (error) {
    console.error("Error fetching emails:", error);
    res.status(500).json({ error: "Error fetching emails" });
  }
});


async function sendAutomatedReply(toEmail, subject, body) {
  oauth2Client.setCredentials({
    access_token: app.locals.user.accessToken,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });


  const rawMessage = [
    `From: ${app.locals.user.profile.emails[0].value}`, 
    `To: ${toEmail}`,
    `Subject: Re: ${subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\n");

  const encodedMessage = base64url.encode(rawMessage);

  try {
    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
      },
    });
    console.log(`Automated reply sent to: ${toEmail}`);
    console.log(`Subject: Re: ${subject}`);
    console.log(`Body: ${body}`);
  } catch (error) {
    console.error("Error sending automated reply:", error);
  }
}

async function checkForNewEmails() {
  if (!app.locals.user) {
    console.log("User not authenticated");
    return;
  }

  oauth2Client.setCredentials({
    access_token: app.locals.user.accessToken,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread",
      maxResults: 10,
    });

    const messages = response.data.messages || [];
    const emailPromises = messages.map(async (message) => {
      const email = await gmail.users.messages.get({
        userId: "me",
        id: message.id,
        format: "full",
      });

      const headers = email.data.payload.headers;
      const subject =
        headers.find((header) => header.name === "Subject")?.value ||
        "No Subject";
      const from =
        headers.find((header) => header.name === "From")?.value ||
        "Unknown Sender";

      let body = "";
      if (email.data.payload.parts) {
        body = email.data.payload.parts[0].body.data;
      } else if (email.data.payload.body) {
        body = email.data.payload.body.data;
      }

      const decodedBody = body
        ? Buffer.from(body, "base64").toString("utf-8")
        : "No content";

      const category = await categorizeEmailContent(decodedBody);

      let replyMessage = "";

      switch (category) {
        case "Interested":
          replyMessage = `Thank you for your interest! We will get back to you soon regarding "${subject}".`;
          break;
        case "Not Interested":
          replyMessage = `We appreciate your response. If you change your mind, feel free to reach out.`;
          break;
        case "More Information":
          replyMessage = `Thank you for reaching out. Could you please provide more details about "${subject}"?`;
          break;
        default:
          replyMessage = `Thank you for your email. We will get back to you soon.`;
      }

      await sendAutomatedReply(from, subject, replyMessage);
    });

    await Promise.all(emailPromises);
  } catch (error) {
    console.error("Error checking for new emails:", error);
  }
}


setInterval(checkForNewEmails, 6000);

setInterval(checkForNewEmails, 5 * 60 * 1000);

app.listen(3000, () => {
  console.log("Server started on http://localhost:3000");
});
