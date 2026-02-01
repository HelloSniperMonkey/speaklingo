1) for running backend code first source the backend environment: ```source /Users/soumyayotimohanta/Developer/hackathon/webrtc-translator/backend/.venv/bin/activate```
2) the frontend is always running no need to restart it unnecessarily to check anything ```run npm run build``` in the frontend directory to build the latest changes
3) never do llm calls with core functionality in frontend. those should be handled in backend
4) voice generation using voice cloning should use the sample rate from the original audio file. if you are using a different sample rate, the voice will sound distorted.