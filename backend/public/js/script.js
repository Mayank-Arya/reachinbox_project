document.addEventListener("DOMContentLoaded", () => {
  const extractEmail = (data) => {
    const match = data.match(
      /(?:<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?:>)?/
    );
    return match ? match[1] : null;
  };


  async function fetchEmails() {
    try {
      const response = await fetch("http://localhost:3000/api/emails");
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      const emails = await response.json();

      const interestedList = document.getElementById("interested-list");
      const notInterestedList = document.getElementById("not-interested-list");
      const moreInfoList = document.getElementById("more-info-list");


      interestedList.innerHTML = "";
      notInterestedList.innerHTML = "";
      moreInfoList.innerHTML = "";

      emails.forEach((email) => {
        const emailItem = document.createElement("div");
        emailItem.classList.add("email-item");
        emailItem.innerHTML = `
            <div class="email-summary">
              <strong>From:</strong> ${email.from}<br>
              <strong>Subject:</strong> ${email.subject}<br>
              <button onclick="viewEmail('${email.id}')">View</button>
            </div>
          `;

        if (email.category === "Interested") {
          interestedList.appendChild(emailItem);
        } else if (email.category === "Not Interested") {
          notInterestedList.appendChild(emailItem);
        } else {
          moreInfoList.appendChild(emailItem);
        }
      });
    } catch (error) {
      console.error("Error fetching emails:", error);
    }
  }

  window.viewEmail = async function (emailId) {
    try {
      const response = await fetch(`http://localhost:3000/email/${emailId}`);
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      const email = await response.json();
      let emailArray = [];
      let emid = extractEmail(email.from); 
      emailArray.push(emid);
      document.getElementById("email-content").innerHTML = `
        <h2>${email.subject}</h2>
        <p><strong>From:</strong> ${emid}</p>
        <div>${email.body}</div>
        <h3>Suggested Response</h3>
        <div id="suggested-response"></div>
        <button id="send-response-btn" onclick="sendResponse('${emid}')">Send Response</button>
      `;

      getSuggestion(email.body);
    } catch (error) {
      console.error("Error fetching email details:", error);
    }
  };

  async function getSuggestion(emailContent) {
    try {
      const response = await fetch("http://localhost:3000/suggest-response", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: emailContent }),
      });

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      const data = await response.json();
      document.getElementById("suggested-response").innerText = data.suggestion;
    } catch (error) {
      console.error("Error fetching suggestion:", error);
    }
  }


  window.sendResponse = async function (email) {
    const suggestedResponse = document.getElementById("suggested-response").innerText;

    try {
      const response = await fetch("http://localhost:3000/send-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, response: suggestedResponse }),
      });

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      alert("Response sent successfully!");
    } catch (error) {
      console.log("Error sending response:", error);
    }
  };

  fetchEmails();
});
