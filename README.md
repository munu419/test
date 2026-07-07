# B1
```
name: Sayura MD Bot Runner

on:
  push:
    branches:
      - main
  workflow_dispatch:
  schedule:
    - cron: '0 */5 * * *' # සෑම පැය 5කටම වරක් ස්වයංක්‍රීයව පටන් ගනී

# 🛡️ එකම වෙලාවේ Instances දෙකක් දුවන එක නවත්වන ප්‍රධානම කෑල්ල
concurrency:
  group: sayura-bot-cluster
  cancel-in-progress: true

permissions:
  contents: read
  actions: write

jobs:
  run-bot:
    runs-on: ubuntu-latest
    timeout-minutes: 350 # පැය 6කට ආසන්න කාලයක්

    steps:
    - name: Checkout repository
      uses: actions/checkout@v3

    - name: Set up Node.js
      uses: actions/setup-node@v3
      with:
        node-version: 20

    - name: Install System Dependencies
      run: |
        sudo apt-get update
        sudo apt-get install -y ffmpeg
        sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
        sudo chmod a+rx /usr/local/bin/yt-dlp

    - name: Install Node dependencies
      run: npm install

    - name: Start Bot
      env:
        MONGO_URI: ${{ secrets.MONGO_URI }}
      run: |
        echo "🚀 Sayura MD Bot is starting..."
        # බොට් එක foreground එකේ රන් කරනවා, එවිට workflow එක බොට් එක්කම පණ පිටින් තියෙනවා
        npm start

    - name: Auto Restart Workflow
      if: always()
      env:
        GH_TOKEN: ${{ secrets.GH_TOKEN }}
      run: |
        echo "🔄 Restarting workflow to keep bot alive..."
        curl -X POST \
        -H "Accept: application/vnd.github+json" \
        -H "Authorization: Bearer $GH_TOKEN" \
        https://api.github.com/repos/${{ github.repository }}/actions/workflows/node.yml/dispatches \
        -d '{"ref":"main"}'
```
